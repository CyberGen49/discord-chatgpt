
// This script is used to write the stats.json file from what's in the database
// Only use this if necessary, the stats file is normally written automatically

const fs = require('fs');
const sqlite3 = require('better-sqlite3');

const db = sqlite3('main.db');
const stats = {
    totalInteractions: 0,
    totalTokens: 0,
    users: {}
};
const messages = db.prepare(`SELECT user_id, count_tokens FROM messages`).all();
for (const message of messages) {
    stats.totalInteractions++;
    stats.totalTokens += message.count_tokens;
    if (!stats.users[message.user_id]) {
        stats.users[message.user_id] = {
            interactions: 0,
            tokens: 0
        };
    }
    stats.users[message.user_id].interactions++;
    stats.users[message.user_id].tokens += message.count_tokens;
}
fs.writeFileSync('stats.json', JSON.stringify(stats, null, 4));