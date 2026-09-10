const fs = require('fs');
const db = require('../lib/db');
const store = require('../lib/store');

async function main() {
  const file = process.argv[2];
  if (file == null || file === '') {
    console.error('Использование: node scripts/import-dump.js <файл.json>');
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.ensureSchema();
  const counts = {};
  for (const kind of db.KEYS) {
    const rows = Array.isArray(dump[kind]) ? dump[kind] : [];
    for (let i = 0; i < rows.length; i += 1) {
      await store.upsertRow(kind, rows[i], { position: i + 1 });
    }
    counts[kind] = rows.length;
  }
  const votes = Array.isArray(dump.votes) ? dump.votes : [];
  for (const vote of votes) {
    if (vote.device == null || vote.song_id == null) {
      continue;
    }
    await db.query(
      `INSERT INTO votes (device, song_id, created_at, like_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (device, song_id) DO NOTHING`,
      [String(vote.device), String(vote.song_id), String(vote.created_at || new Date().toISOString()), String(vote.like_id || '')],
    );
  }
  counts.votes = votes.length;

  const items = Array.isArray(dump.lineup) ? dump.lineup : [];
  for (const item of items) {
    if (item.id == null) {
      continue;
    }
    await db.query(
      `INSERT INTO lineup (id, position, kind, song_id, label, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET position = excluded.position, kind = excluded.kind,
         song_id = excluded.song_id, label = excluded.label`,
      [
        String(item.id),
        Number(item.position == null ? 0 : item.position),
        String(item.kind == null ? 'song' : item.kind),
        String(item.songId == null ? (item.song_id == null ? '' : item.song_id) : item.songId),
        String(item.label == null ? '' : item.label),
        String(item.createdAt == null ? (item.created_at == null ? new Date().toISOString() : item.created_at) : item.createdAt),
      ],
    );
  }
  counts.lineup = items.length;

  const meta = Array.isArray(dump.meta) ? dump.meta : [];
  for (const record of meta) {
    if (record.key == null) {
      continue;
    }
    await db.writeMeta(String(record.key), String(record.value == null ? '' : record.value));
  }
  counts.meta = meta.length;

  console.log(`Перенесено: участников ${counts.participants}, песен ${counts.songs}, лайков ${counts.likes}, голосов ${counts.votes}, позиций лайнапа ${counts.lineup}, настроек ${counts.meta}`);
  process.exit(0);
}

main().catch(error => {
  console.error(`Импорт не удался: ${error.message}`);
  process.exit(1);
});
