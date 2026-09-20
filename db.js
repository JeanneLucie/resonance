// Petite couche de persistance basée sur un fichier JSON.
// Suffisante pour démarrer et tester Résonance. Pour une mise en
// production avec plusieurs visiteurs simultanés, remplacez ceci par
// une vraie base de données (PostgreSQL, MySQL, SQLite...).

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function readDb() {
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function nextId(list) {
  return list.length === 0 ? 1 : Math.max(...list.map((x) => x.id)) + 1;
}

module.exports = { readDb, writeDb, nextId };
