const store = require('./store');

const TOOL_URL = 'http://localhost:4005';

async function getStatus() {
  const counts = await Promise.all([
    store.countRows('participants'),
    store.countRows('songs'),
    store.countRows('likes'),
  ]);
  return {
    tool: 'databasus',
    url: TOOL_URL,
    counts: {
      participants: counts[0],
      songs: counts[1],
      likes: counts[2],
    },
  };
}

module.exports = { getStatus };
