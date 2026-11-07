// Handy queries for the Neo4j Browser (http://127.0.0.1:7475 with the default setup).
// Load database/neo4j/style.grass first (:style, then drop the file) so the graph is readable.

// 1. The opening tree: every move order of the first 3 moves played in 10+ games.
MATCH p = (:Start)-[:MOVE*1..6]->()
WHERE all(m IN relationships(p) WHERE m.games >= 10)
RETURN p;

// 2. A transposition and every shortest move order that reaches it (blue-ringed node at the end).
MATCH (t:Transposition) WHERE t.opening STARTS WITH "Queen's Gambit Declined"
WITH t ORDER BY t.ply LIMIT 1
MATCH p = allShortestPaths((:Start)-[:MOVE*]->(t))
RETURN p LIMIT 10;

// 3. The most popular transpositions, as a table.
MATCH (t:Transposition)<-[m:MOVE]-()
RETURN t.opening AS opening, t.line AS example_line, count(m) AS entered_from, sum(m.games) AS games
ORDER BY games DESC LIMIT 20;

// 4. Branching points: boards where the stored games disagree the most.
MATCH (b:Position)-[m:MOVE]->()
WITH b, count(m) AS options, sum(m.games) AS games WHERE options >= 4
RETURN b.line AS after, b.opening AS opening, options, games ORDER BY options DESC, games DESC LIMIT 20;

// 5. One game's path through the graph (game ids are on every edge it used).
MATCH p = (:Start)-[:MOVE*]->(end)
WHERE all(m IN relationships(p) WHERE 1 IN m.game_ids) AND NOT EXISTS { (end)-[m:MOVE]->() WHERE 1 IN m.game_ids }
RETURN p LIMIT 1;
