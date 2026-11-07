-- Full-text search over the human-readable catalogue (player names, opening names,
-- tournament names/locations). InnoDB FULLTEXT indexes are added with ALTER TABLE so the
-- original submitted CREATE TABLE statements stay unchanged.
-- Note: InnoDB ignores tokens shorter than innodb_ft_min_token_size (default 3).

ALTER TABLE player ADD FULLTEXT INDEX ft_player_name (name);
ALTER TABLE opening ADD FULLTEXT INDEX ft_opening_name (name);
ALTER TABLE tournament ADD FULLTEXT INDEX ft_tournament_text (name, location);
