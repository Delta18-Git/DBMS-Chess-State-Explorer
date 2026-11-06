-- MySQL 8.4 / InnoDB. Apply once to an EMPTY database with scripts/init-db.ts.
-- The nine domain tables preserve Submission1.pdf; extra constraints protect API invariants.
CREATE TABLE player (
    player_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    title VARCHAR(10) NULL,
    federation CHAR(3) NULL,
    birth_year SMALLINT NULL,
    rating SMALLINT NULL,
    CONSTRAINT chk_player_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT chk_player_rating CHECK (rating IS NULL OR rating BETWEEN 0 AND 3500),
    CONSTRAINT chk_player_birth_year CHECK (birth_year IS NULL OR birth_year BETWEEN 1850 AND 2100)
) ENGINE=InnoDB;

CREATE TABLE tournament (
    tournament_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    date DATE NULL,
    location VARCHAR(150) NULL,
    CONSTRAINT chk_tournament_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB;

CREATE TABLE opening (
    opening_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    eco CHAR(3) NOT NULL,
    name VARCHAR(150) NOT NULL,
    CONSTRAINT uq_opening_eco_name UNIQUE (eco, name),
    CONSTRAINT chk_opening_eco CHECK (REGEXP_LIKE(eco, '^[A-E][0-9]{2}$', 'c')),
    CONSTRAINT chk_opening_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB;

CREATE TABLE `position` (
    position_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fen VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    comment TEXT NULL,
    CONSTRAINT uq_position_fen UNIQUE (fen),
    -- Application additionally checks chess legality and canonicalizes FEN clocks.
    CONSTRAINT chk_position_fen CHECK (CHAR_LENGTH(fen) BETWEEN 15 AND 100)
) ENGINE=InnoDB;

CREATE TABLE game (
    game_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    white_player_id INT UNSIGNED NOT NULL,
    black_player_id INT UNSIGNED NOT NULL,
    tournament_id INT UNSIGNED NULL,
    opening_id INT UNSIGNED NULL,
    date DATE NULL,
    result ENUM('1-0', '0-1', '1/2-1/2', '*') NOT NULL,
    pgn TEXT NULL,
    CONSTRAINT fk_game_white FOREIGN KEY (white_player_id) REFERENCES player(player_id) ON DELETE RESTRICT,
    CONSTRAINT fk_game_black FOREIGN KEY (black_player_id) REFERENCES player(player_id) ON DELETE RESTRICT,
    CONSTRAINT fk_game_tournament FOREIGN KEY (tournament_id) REFERENCES tournament(tournament_id) ON DELETE RESTRICT,
    CONSTRAINT fk_game_opening FOREIGN KEY (opening_id) REFERENCES opening(opening_id) ON DELETE RESTRICT,
    CONSTRAINT chk_game_distinct_players CHECK (white_player_id <> black_player_id),
    INDEX idx_game_white_date (white_player_id, date),
    INDEX idx_game_black_date (black_player_id, date)
) ENGINE=InnoDB;

CREATE TABLE ply (
    ply_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    game_id INT UNSIGNED NOT NULL,
    ply_no SMALLINT UNSIGNED NOT NULL,
    side ENUM('w', 'b') NOT NULL,
    move_san VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    from_position_id INT UNSIGNED NOT NULL,
    to_position_id INT UNSIGNED NOT NULL,
    CONSTRAINT fk_ply_game FOREIGN KEY (game_id) REFERENCES game(game_id) ON DELETE RESTRICT,
    CONSTRAINT fk_ply_from_position FOREIGN KEY (from_position_id) REFERENCES `position`(position_id) ON DELETE RESTRICT,
    CONSTRAINT fk_ply_to_position FOREIGN KEY (to_position_id) REFERENCES `position`(position_id) ON DELETE RESTRICT,
    CONSTRAINT uq_ply_game_moveno UNIQUE (game_id, ply_no),
    CONSTRAINT chk_ply_no CHECK (ply_no > 0),
    CONSTRAINT chk_ply_side CHECK ((MOD(ply_no, 2) = 1 AND side = 'w') OR (MOD(ply_no, 2) = 0 AND side = 'b')),
    CONSTRAINT chk_ply_move CHECK (CHAR_LENGTH(TRIM(move_san)) > 0)
) ENGINE=InnoDB;

CREATE TABLE evaluation (
    evaluation_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    position_id INT UNSIGNED NOT NULL,
    cp INT NULL,
    depth TINYINT UNSIGNED NOT NULL,
    CONSTRAINT fk_evaluation_position FOREIGN KEY (position_id) REFERENCES `position`(position_id) ON DELETE RESTRICT,
    CONSTRAINT chk_evaluation_depth CHECK (depth > 0),
    CONSTRAINT chk_evaluation_cp CHECK (cp IS NULL OR cp BETWEEN -100000 AND 100000),
    INDEX idx_evaluation_position_depth (position_id, depth DESC, evaluation_id DESC)
) ENGINE=InnoDB;

CREATE TABLE repertoire (
    repertoire_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id INT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    CONSTRAINT fk_repertoire_player FOREIGN KEY (player_id) REFERENCES player(player_id) ON DELETE RESTRICT,
    CONSTRAINT chk_repertoire_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB;

CREATE TABLE repertoire_line (
    repertoire_line_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    repertoire_id INT UNSIGNED NOT NULL,
    start_position_id INT UNSIGNED NOT NULL,
    move_san VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    CONSTRAINT fk_repline_repertoire FOREIGN KEY (repertoire_id) REFERENCES repertoire(repertoire_id) ON DELETE RESTRICT,
    CONSTRAINT fk_repline_position FOREIGN KEY (start_position_id) REFERENCES `position`(position_id) ON DELETE RESTRICT,
    CONSTRAINT chk_repline_move CHECK (CHAR_LENGTH(TRIM(move_san)) > 0)
) ENGINE=InnoDB;

-- A meaningful ALTER demonstration, not a destructive reset of submitted tables.
ALTER TABLE repertoire_line ADD CONSTRAINT uq_repertoire_move UNIQUE (repertoire_id, start_position_id, move_san);
CREATE INDEX idx_opening_eco ON opening(eco);

-- Authentication is separate from chess players; a player is not a login account.
CREATE TABLE app_user (
    user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(200) CHARACTER SET ascii NOT NULL,
    role ENUM('admin', 'analyst') NOT NULL,
    failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE api_session (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES app_user(user_id) ON DELETE CASCADE,
    INDEX idx_session_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE evaluation_audit (
    audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    evaluation_id INT UNSIGNED NOT NULL,
    action ENUM('INSERT', 'DELETE') NOT NULL,
    snapshot JSON NOT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Highest depth wins; latest inserted evaluation breaks equal-depth ties.
CREATE VIEW v_latest_evaluation AS
SELECT evaluation_id, position_id, cp, depth FROM (
    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY position_id ORDER BY depth DESC, evaluation_id DESC) AS rn
    FROM evaluation e
) ranked WHERE rn = 1;

-- All cp values are White's perspective. NULL scores are excluded, never treated as zero.
CREATE VIEW v_ply_analysis AS
SELECT p.ply_id, p.game_id, p.ply_no, p.side, p.move_san,
       CASE WHEN p.side = 'w' THEN g.white_player_id ELSE g.black_player_id END AS player_id,
       before_eval.cp AS before_cp, after_eval.cp AS after_cp,
       GREATEST(0, (before_eval.cp - after_eval.cp) * IF(p.side = 'w', 1, -1)) AS cp_loss
FROM ply p
JOIN game g ON g.game_id = p.game_id
LEFT JOIN v_latest_evaluation before_eval ON before_eval.position_id = p.from_position_id
LEFT JOIN v_latest_evaluation after_eval ON after_eval.position_id = p.to_position_id;

-- Single-statement routine/trigger bodies keep the SQL runnable without client DELIMITER directives.
CREATE PROCEDURE sp_player_summary(IN requested_player_id INT UNSIGNED)
SELECT p.player_id, p.name, COUNT(g.game_id) AS games,
       COALESCE(SUM((g.white_player_id = p.player_id AND g.result = '1-0') OR
                    (g.black_player_id = p.player_id AND g.result = '0-1')), 0) AS wins,
       COALESCE(SUM(g.result = '1/2-1/2'), 0) AS draws,
       COALESCE(SUM((g.white_player_id = p.player_id AND g.result = '0-1') OR
                    (g.black_player_id = p.player_id AND g.result = '1-0')), 0) AS losses,
       COALESCE(SUM(g.result = '*'), 0) AS unfinished,
       (SELECT COUNT(cp_loss) FROM v_ply_analysis a WHERE a.player_id = p.player_id) AS evaluated_plies,
       (SELECT ROUND(AVG(cp_loss), 2) FROM v_ply_analysis a WHERE a.player_id = p.player_id) AS average_cp_loss,
       (SELECT COUNT(*) FROM v_ply_analysis a WHERE a.player_id = p.player_id AND cp_loss >= 200) AS blunders,
       (SELECT ROUND(100.0 * SUM(cp_loss >= 200) / NULLIF(COUNT(cp_loss), 0), 2)
        FROM v_ply_analysis a WHERE a.player_id = p.player_id) AS blunder_rate_pct
FROM player p LEFT JOIN game g ON g.white_player_id = p.player_id OR g.black_player_id = p.player_id
WHERE p.player_id = requested_player_id GROUP BY p.player_id, p.name;

CREATE TRIGGER trg_evaluation_insert AFTER INSERT ON evaluation FOR EACH ROW
INSERT INTO evaluation_audit (evaluation_id, action, snapshot)
VALUES (NEW.evaluation_id, 'INSERT', JSON_OBJECT('position_id', NEW.position_id, 'cp', NEW.cp, 'depth', NEW.depth));

CREATE TRIGGER trg_evaluation_delete AFTER DELETE ON evaluation FOR EACH ROW
INSERT INTO evaluation_audit (evaluation_id, action, snapshot)
VALUES (OLD.evaluation_id, 'DELETE', JSON_OBJECT('position_id', OLD.position_id, 'cp', OLD.cp, 'depth', OLD.depth));
