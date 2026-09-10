const reference = require('./reference');
const data = require('./data');

const HTTP_URL_PATTERN = /^https?:\/\//i;

const TELEGRAM_PATTERN = /^[A-Za-z0-9_]{3,32}$/;

const enrichSongs = (songs, participants, likes) => {
  const byId = participantMap(participants);
  const counts = countLikes(likes);
  return asArray(songs).map(song => {
    const performerIds = splitList(song.performers);
    const performerNames = [];
    performerIds.forEach(x => {
      const performer = byId[x];
      if (performer != null && asText(performer.name) !== '') {
        performerNames.push(asText(performer.name));
      }
    });
    const author = byId[asText(song.added_by)];
    const isWish = song.type === 'wish';
    return Object.assign({}, song, {
      likes: counts[song.id] == null ? 0 : counts[song.id],
      performerIds: performerIds,
      performerNames: performerNames,
      addedByName: author == null ? '' : asText(author.name),
      gearList: splitList(song.gear),
      needPrompter: parseBool(song.need_prompter, true),
      showOnProjector: parseBool(song.show_on_projector, true),
      isWish: isWish,
      isOpenWish: isWish && performerIds.length === 0,
      needsMusicians: asText(song.need_musicians) !== '',
      isCancelled: song.status === reference.STATUS_CANCELLED,
      lyricsUrlSafe: safeHttpUrl(song.lyrics_url),
    });
  });
};

const activeSongs = songs => {
  return asArray(songs).filter(x => x.status !== reference.STATUS_CANCELLED);
};

const playableSongs = songs => {
  return asArray(songs).filter(x => x.type === 'perform' || (x.type === 'wish' && performerIdsOf(x).length > 0));
};

const openWishes = songs => {
  return asArray(songs).filter(x => x.type === 'wish' && performerIdsOf(x).length === 0);
};

const sortSongs = (songs, sort) => {
  const list = asArray(songs).slice();
  if (sort === 'new') {
    list.sort((a, b) => compareCreated(a, b));
    return list;
  }
  list.sort((a, b) => {
    const byLikes = (b.likes == null ? 0 : b.likes) - (a.likes == null ? 0 : a.likes);
    if (byLikes !== 0) {
      return byLikes;
    }
    return compareCreated(a, b);
  });
  return list;
};

const filterSongs = (songs, q) => {
  const needle = asText(q).toLowerCase();
  const list = asArray(songs);
  if (needle === '') {
    return list.slice();
  }
  return list.filter(x => {
    const haystack = (asText(x.title) + ' ' + asText(x.original_artist)).toLowerCase();
    return haystack.indexOf(needle) !== -1;
  });
};

const resolveWho = async (body, participants) => {
  const participantId = asText(body.participant_id);
  if (participantId === reference.NEW_PARTICIPANT_OPTION) {
    const name = asText(body.new_name);
    if (name === '') {
      throw new FormError('Напиши, как тебя зовут');
    }
    return data.addParticipant({
      name: name,
      telegram: asText(body.new_telegram),
      instruments: asList(body.new_instruments),
      can_help: false,
    });
  }
  const found = asArray(participants).find(x => x.id === participantId);
  if (found == null) {
    throw new FormError('Выбери себя из списка');
  }
  return found;
};

const resolvePartners = async (body, participants) => {
  const known = participantMap(participants);
  const ids = [];
  asList(body.partners).forEach(x => {
    if (known[x] != null && ids.indexOf(x) === -1) {
      ids.push(x);
    }
  });
  const names = asArray(body.partner_name);
  const instruments = asArray(body.partner_instruments);
  for (let i = 0; i < names.length; i += 1) {
    const name = asText(names[i]);
    if (name !== '') {
      const created = await data.addParticipant({
        name: name,
        instruments: splitList(instruments[i]),
        can_help: false,
      });
      if (ids.indexOf(created.id) === -1) {
        ids.push(created.id);
      }
    }
  }
  return ids;
};

const participantMap = participants => {
  const map = Object.create(null);
  asArray(participants).forEach(x => {
    const id = asText(x.id);
    if (id !== '') {
      map[id] = x;
    }
  });
  return map;
};

const countLikes = likes => {
  const counts = Object.create(null);
  asArray(likes).forEach(x => {
    const songId = asText(x.song_id);
    if (songId !== '') {
      counts[songId] = (counts[songId] == null ? 0 : counts[songId]) + 1;
    }
  });
  return counts;
};

const performerIdsOf = song => {
  if (Array.isArray(song.performerIds)) {
    return song.performerIds;
  }
  return splitList(song.performers);
};

const compareCreated = (a, b) => {
  return asText(b.created_at).localeCompare(asText(a.created_at));
};

const parseBool = (value, defaultValue = false) => {
  const text = asText(value).toUpperCase();
  if (text === 'TRUE') {
    return true;
  }
  if (text === 'FALSE') {
    return false;
  }
  return defaultValue;
};

const splitList = value => {
  return asText(value).split(',').map(x => x.trim()).filter(x => x !== '');
};

const safeHttpUrl = value => {
  const text = asText(value);
  if (text === '' || !HTTP_URL_PATTERN.test(text)) {
    return null;
  }
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  } catch (error) {
    return null;
  }
};

const telegramHandle = value => {
  const text = asText(value);
  if (text === '') {
    return null;
  }
  const fromLink = /(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?([A-Za-z0-9_]{3,32})/i.exec(text);
  if (fromLink != null) {
    return fromLink[1];
  }
  const fromDomain = /(?:tg:\/\/resolve\?domain=)([A-Za-z0-9_]{3,32})/i.exec(text);
  if (fromDomain != null) {
    return fromDomain[1];
  }
  const fromAt = /@([A-Za-z0-9_]{3,32})/.exec(text);
  if (fromAt != null) {
    return fromAt[1];
  }
  const bare = text.replace(/\/+$/, '').trim();
  if (TELEGRAM_PATTERN.test(bare)) {
    return bare;
  }
  return null;
};

const safeBackPath = (value, fallback) => {
  if (typeof value !== 'string' || value.charAt(0) !== '/') {
    return fallback;
  }
  if (value.charAt(1) === '/' || value.charAt(1) === '\\') {
    return fallback;
  }
  return value;
};

const asList = value => {
  if (Array.isArray(value)) {
    return value.map(x => asText(x)).filter(x => x !== '');
  }
  return splitList(value);
};

const asKnownList = (value, allowed) => {
  return asList(value).filter(x => allowed.indexOf(x) !== -1);
};

const asArray = value => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
};

const asText = value => {
  if (value == null) {
    return '';
  }
  return String(value).trim();
};

class FormError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FormError';
  }
}

module.exports = {
  parseBool,
  splitList,
  safeHttpUrl,
  telegramHandle,
  safeBackPath,
  countLikes,
  participantMap,
  enrichSongs,
  activeSongs,
  playableSongs,
  openWishes,
  sortSongs,
  filterSongs,
  resolveWho,
  resolvePartners,
  asList,
  asKnownList,
  asArray,
  asText,
  FormError,
};
