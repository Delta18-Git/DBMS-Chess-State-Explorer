-- Real tournament data from the Lichess broadcast + FIDE APIs, the Lichess opening catalogue,
-- richer engine output, named accounts and user-owned repertoires.
-- Everything is ALTER/CREATE on top of the submitted schema; the original CREATE TABLEs stay unchanged.

-- Players are identified across tournaments by FIDE id (from the PGN headers).
ALTER TABLE player
    ADD COLUMN fide_id INT UNSIGNED NULL AFTER player_id,
    ADD COLUMN photo_url VARCHAR(500) NULL,
    ADD CONSTRAINT uq_player_fide UNIQUE (fide_id);

-- Tournament facts come from the broadcast API; source_url makes re-imports idempotent.
ALTER TABLE tournament
    ADD COLUMN end_date DATE NULL AFTER date,
    ADD COLUMN format VARCHAR(100) NULL,
    ADD COLUMN time_control VARCHAR(150) NULL,
    ADD COLUMN source_url VARCHAR(300) NULL,
    ADD COLUMN image_url VARCHAR(500) NULL,
    ADD CONSTRAINT uq_tournament_source UNIQUE (source_url),
    ADD CONSTRAINT chk_tournament_dates CHECK (end_date IS NULL OR date IS NULL OR end_date >= date);

-- Ratings at the time of the game belong to the game, not the player (they change over time).
ALTER TABLE game
    ADD COLUMN round VARCHAR(20) NULL AFTER date,
    ADD COLUMN white_elo SMALLINT NULL,
    ADD COLUMN black_elo SMALLINT NULL,
    ADD COLUMN source_url VARCHAR(300) NULL,
    ADD CONSTRAINT uq_game_source UNIQUE (source_url),
    ADD CONSTRAINT chk_game_elo CHECK ((white_elo IS NULL OR white_elo BETWEEN 0 AND 3500)
                                   AND (black_elo IS NULL OR black_elo BETWEEN 0 AND 3500)),
    ADD INDEX idx_game_date (date);

-- Catalogue openings name a board: the position their main line reaches.
ALTER TABLE opening
    ADD COLUMN pgn VARCHAR(1000) NULL,
    ADD COLUMN position_id INT UNSIGNED NULL,
    ADD CONSTRAINT fk_opening_position FOREIGN KEY (position_id) REFERENCES `position`(position_id) ON DELETE RESTRICT;

-- Engine output: the move Stockfish preferred and forced-mate distance (White's view).
ALTER TABLE evaluation
    ADD COLUMN best_move_san VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN mate SMALLINT NULL,
    ADD CONSTRAINT chk_evaluation_score CHECK (cp IS NULL OR mate IS NULL);

ALTER TABLE app_user ADD COLUMN display_name VARCHAR(100) NULL AFTER email;

-- Analysts may keep their own repertoires; admins manage all of them.
ALTER TABLE repertoire
    ADD COLUMN color ENUM('w', 'b') NOT NULL DEFAULT 'w',
    ADD COLUMN owner_user_id INT UNSIGNED NULL,
    ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD CONSTRAINT fk_repertoire_owner FOREIGN KEY (owner_user_id) REFERENCES app_user(user_id) ON DELETE SET NULL;

-- The audit snapshot now records the new engine columns too (DROP + CREATE: triggers cannot be altered).
DROP TRIGGER trg_evaluation_insert;
DROP TRIGGER trg_evaluation_delete;

CREATE TRIGGER trg_evaluation_insert AFTER INSERT ON evaluation FOR EACH ROW
INSERT INTO evaluation_audit (evaluation_id, action, snapshot)
VALUES (NEW.evaluation_id, 'INSERT', JSON_OBJECT('position_id', NEW.position_id, 'cp', NEW.cp, 'mate', NEW.mate,
        'depth', NEW.depth, 'best_move', NEW.best_move_san));

CREATE TRIGGER trg_evaluation_delete AFTER DELETE ON evaluation FOR EACH ROW
INSERT INTO evaluation_audit (evaluation_id, action, snapshot)
VALUES (OLD.evaluation_id, 'DELETE', JSON_OBJECT('position_id', OLD.position_id, 'cp', OLD.cp, 'mate', OLD.mate,
        'depth', OLD.depth, 'best_move', OLD.best_move_san));

-- The best evaluation view gains the new columns (CREATE OR REPLACE keeps dependants valid).
CREATE OR REPLACE VIEW v_latest_evaluation AS
SELECT evaluation_id, position_id, cp, mate, depth, best_move_san FROM (
    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY position_id ORDER BY depth DESC, evaluation_id DESC) AS rn
    FROM evaluation e
) ranked WHERE rn = 1;

-- One row per (game, player): the same game seen from each side. Standings, colour splits
-- and opening repertoires are all simple GROUP BYs over this view.
CREATE VIEW v_player_game AS
SELECT g.game_id, g.tournament_id, g.opening_id, g.date, g.round, 'w' AS color,
       g.white_player_id AS player_id, g.black_player_id AS opponent_id,
       g.white_elo AS player_elo, g.black_elo AS opponent_elo, g.result,
       CASE g.result WHEN '1-0' THEN 1.0 WHEN '1/2-1/2' THEN 0.5 WHEN '0-1' THEN 0.0 END AS score
FROM game g
UNION ALL
SELECT g.game_id, g.tournament_id, g.opening_id, g.date, g.round, 'b',
       g.black_player_id, g.white_player_id, g.black_elo, g.white_elo, g.result,
       CASE g.result WHEN '0-1' THEN 1.0 WHEN '1/2-1/2' THEN 0.5 WHEN '1-0' THEN 0.0 END
FROM game g;

-- Move quality now counts forced mates too: a score is the centipawn value, or ±1000 for a mate,
-- clamped to ±1000 (10 pawns) like common accuracy formulas, so one lost-won swing cannot dominate.
CREATE OR REPLACE VIEW v_ply_analysis AS
SELECT p.ply_id, p.game_id, p.ply_no, p.side, p.move_san,
       CASE WHEN p.side = 'w' THEN g.white_player_id ELSE g.black_player_id END AS player_id,
       sb.score AS before_cp, sa.score AS after_cp,
       GREATEST(0, (sb.score - sa.score) * IF(p.side = 'w', 1, -1)) AS cp_loss
FROM ply p
JOIN game g ON g.game_id = p.game_id
LEFT JOIN (SELECT position_id, GREATEST(-1000, LEAST(1000, COALESCE(cp, SIGN(mate) * 1000))) AS score
           FROM v_latest_evaluation) sb ON sb.position_id = p.from_position_id
LEFT JOIN (SELECT position_id, GREATEST(-1000, LEAST(1000, COALESCE(cp, SIGN(mate) * 1000))) AS score
           FROM v_latest_evaluation) sa ON sa.position_id = p.to_position_id;
