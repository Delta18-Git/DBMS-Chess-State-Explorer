-- Transactional outbox feeding the Neo4j move graph.
-- MySQL is the source of truth. A game INSERT/DELETE writes an outbox row in the SAME
-- transaction (via trigger), so a committed change can never be "forgotten" by the graph,
-- and a rolled-back import never reaches it. The relay (POST /api/graph/sync or
-- `npm run graph:sync`) drains pending rows into Neo4j idempotently and marks them processed.

CREATE TABLE graph_outbox (
    outbox_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    game_id INT UNSIGNED NOT NULL,
    action ENUM('UPSERT', 'DELETE') NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    processed_at TIMESTAMP(3) NULL,
    -- No FK to game: the DELETE event must outlive the deleted game row.
    INDEX idx_graph_outbox_pending (processed_at, outbox_id),
    CONSTRAINT chk_graph_outbox_processed CHECK (processed_at IS NULL OR processed_at >= created_at)
) ENGINE=InnoDB;

CREATE TRIGGER trg_game_graph_insert AFTER INSERT ON game FOR EACH ROW
INSERT INTO graph_outbox (game_id, action) VALUES (NEW.game_id, 'UPSERT');

CREATE TRIGGER trg_game_graph_delete AFTER DELETE ON game FOR EACH ROW
INSERT INTO graph_outbox (game_id, action) VALUES (OLD.game_id, 'DELETE');

-- Aggregated move edges exactly as the graph stores them: one edge per (from, to, SAN),
-- with distinct-game counts and outcomes. The relay and the full rebuild both read this view,
-- so MySQL and Neo4j can never disagree about how an edge is computed.
CREATE VIEW v_move_edge AS
SELECT m.from_position_id, m.to_position_id, m.move_san,
       COUNT(DISTINCT m.game_id) AS games,
       COUNT(DISTINCT CASE WHEN g.result = '1-0' THEN m.game_id END) AS white_wins,
       COUNT(DISTINCT CASE WHEN g.result = '0-1' THEN m.game_id END) AS black_wins,
       COUNT(DISTINCT CASE WHEN g.result = '1/2-1/2' THEN m.game_id END) AS draws,
       JSON_ARRAYAGG(m.game_id) AS game_ids
FROM ply m JOIN game g ON g.game_id = m.game_id
GROUP BY m.from_position_id, m.to_position_id, m.move_san;
