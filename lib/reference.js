const INSTRUMENTS = [
  'вокал',
  'акустическая гитара',
  'классическая гитара',
  'электрогитара',
  'бас',
  'укулеле',
  'клавиши',
  'кахон',
  'перкуссия',
  'скрипка',
  'флейта',
  'губная гармошка',
  'другое',
  'не играю — просто слушаю',
];

const GEAR = [
  'микрофон',
  'второй микрофон',
  'электрогитара с процем',
  'басгитара',
  'электроскрипка',
  'подключение в пульт',
  'подложка по bluetooth',
  'стойка',
  'стул',
  'розетка',
];

const STATUSES = ['заявлена', 'ищем исполнителя', 'в сетлисте', 'резерв', 'отменена'];

const STATUS_CANCELLED = 'отменена';

const STATUS_DECLARED = 'заявлена';

const STATUS_LOOKING = 'ищем исполнителя';

const STATUS_SETLIST = 'в сетлисте';

const SONG_TYPES = ['perform', 'wish'];

const PARTICIPANT_HEADERS = [
  'id',
  'name',
  'telegram',
  'instruments',
  'can_help',
  'help_instruments',
  'about',
  'created_at',
];

const SONG_HEADERS = [
  'id',
  'title',
  'original_artist',
  'type',
  'added_by',
  'performers',
  'who_plays_what',
  'need_musicians',
  'gear',
  'own_gear',
  'lyrics',
  'lyrics_url',
  'need_prompter',
  'show_on_projector',
  'note',
  'status',
  'created_at',
];

const LIKE_HEADERS = ['id', 'song_id', 'name', 'created_at'];

const DEFAULT_SHEET_NAMES = {
  participants: 'Участники',
  songs: 'Песни',
  likes: 'Лайки',
};

const SHEET_HEADERS = {
  participants: PARTICIPANT_HEADERS,
  songs: SONG_HEADERS,
  likes: LIKE_HEADERS,
};

const NEW_PARTICIPANT_OPTION = '__new__';

module.exports = {
  INSTRUMENTS,
  GEAR,
  STATUSES,
  STATUS_CANCELLED,
  STATUS_DECLARED,
  STATUS_LOOKING,
  STATUS_SETLIST,
  SONG_TYPES,
  PARTICIPANT_HEADERS,
  SONG_HEADERS,
  LIKE_HEADERS,
  DEFAULT_SHEET_NAMES,
  SHEET_HEADERS,
  NEW_PARTICIPANT_OPTION,
};
