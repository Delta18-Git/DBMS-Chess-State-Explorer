-- Metadata only: import real PGN through POST /api/games so legality is validated.
INSERT INTO player (name, title, federation, birth_year, rating) VALUES
('Magnus Carlsen', 'GM', 'NOR', 1990, 2830),
('Viswanathan Anand', 'GM', 'IND', 1969, 2750),
('Demo White', NULL, 'IND', 2000, 1600),
('Demo Black', NULL, 'IND', 2001, 1550);
INSERT INTO tournament (name, date, location) VALUES ('Transposition demonstration', '2026-01-01', 'Bengaluru');
INSERT INTO opening (eco, name) VALUES ('A05', 'Reti: Kingside fianchetto'), ('B20', 'Sicilian Defence'), ('C20', 'King Pawn Game');
INSERT INTO `position` (fen, comment) VALUES
('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'Standard starting position');
