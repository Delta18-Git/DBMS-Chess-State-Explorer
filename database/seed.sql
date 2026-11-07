-- The only row every database needs: the initial board (the root of the move graph).
-- Real players, tournaments, openings and games are imported by `npm run setup` through the API
-- (Lichess broadcasts + the Lichess opening catalogue), never inserted by hand.
INSERT INTO `position` (fen, comment) VALUES
('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'Standard starting position');
