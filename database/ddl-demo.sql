-- Optional standalone CREATE/ALTER/DROP demonstration: does not touch application data.
CREATE TEMPORARY TABLE ddl_demo (id INT PRIMARY KEY);
ALTER TABLE ddl_demo ADD COLUMN explanation VARCHAR(100) NOT NULL DEFAULT 'DDL demonstration';
INSERT INTO ddl_demo (id) VALUES (1);
SELECT * FROM ddl_demo;
DROP TEMPORARY TABLE ddl_demo;
