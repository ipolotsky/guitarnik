const PARTICIPANT_KEY = 'guitarnik.participant';

const NEW_PARTICIPANT_OPTION = '__new__';

const NAME_SEPARATOR = ' - ';

document.addEventListener('DOMContentLoaded', () => {
  setupWho();
  setupLikes();
  setupPicker();
  setupPartners();
  setupRemember();
  setupConfirm();
});

const setupConfirm = () => {
  Array.from(document.querySelectorAll('[data-confirm]')).forEach(form => {
    form.addEventListener('submit', event => {
      if (!window.confirm(form.getAttribute('data-confirm'))) {
        event.preventDefault();
      }
    });
  });
};

const setupPicker = () => {
  const picker = document.querySelector('[data-picker]');
  if (picker == null) {
    return;
  }
  const chips = picker.querySelector('[data-picker-chips]');
  const search = picker.querySelector('[data-picker-search]');
  const options = Array.from(picker.querySelectorAll('[data-picker-option]'));
  const boxes = options.map(x => x.querySelector('input[type="checkbox"]'));
  const renderChips = () => {
    chips.textContent = '';
    const chosen = boxes.filter(x => x.checked);
    chips.hidden = chosen.length === 0;
    chosen.forEach(box => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'btn btn-primary btn-sm';
      chip.textContent = box.getAttribute('data-name');
      chip.title = 'Убрать из состава';
      const icon = document.createElement('i');
      icon.className = 'bi bi-x-lg ms-1';
      chip.appendChild(icon);
      chip.addEventListener('click', () => {
        box.checked = false;
        renderChips();
      });
      chips.appendChild(chip);
    });
  };
  boxes.forEach(box => {
    box.addEventListener('change', renderChips);
  });
  if (search != null) {
    search.addEventListener('input', () => {
      filterPicker(picker, options, search.value);
    });
  }
  renderChips();
};

const filterPicker = (picker, options, query) => {
  const needle = query.trim().toLowerCase();
  let visible = 0;
  options.forEach(option => {
    const match = needle === '' || option.getAttribute('data-search').indexOf(needle) !== -1;
    option.hidden = !match;
    if (match) {
      visible += 1;
    }
  });
  picker.querySelectorAll('[data-picker-group]').forEach(group => {
    let next = group.nextElementSibling;
    let shown = false;
    while (next != null && next.hasAttribute('data-picker-option')) {
      if (!next.hidden) {
        shown = true;
      }
      next = next.nextElementSibling;
    }
    group.hidden = !shown;
  });
  const empty = picker.querySelector('[data-picker-empty]');
  if (empty != null) {
    empty.hidden = visible > 0;
  }
};

const setupWho = () => {
  const select = document.querySelector('[data-who]');
  if (select == null) {
    return;
  }
  const newBlock = document.querySelector('[data-who-new]');
  const remembers = select.getAttribute('data-who-remember') !== '0';
  const stored = remembers ? readStored(PARTICIPANT_KEY) : null;
  if (select.value === '' && stored != null && stored.id) {
    for (let i = 0; i < select.options.length; i += 1) {
      if (select.options[i].value === stored.id) {
        select.value = stored.id;
        break;
      }
    }
  }
  toggleNewBlock(select, newBlock);
  select.addEventListener('change', () => {
    toggleNewBlock(select, newBlock);
    rememberParticipant(select);
  });
  setupWhoSearch(select);
};

const setupWhoSearch = select => {
  const search = document.querySelector('[data-who-search]');
  if (search == null) {
    return;
  }
  const all = Array.from(select.options).map(option => ({
    value: option.value,
    label: option.textContent,
    haystack: option.textContent.toLowerCase(),
  }));
  search.addEventListener('input', () => {
    const needle = search.value.trim().toLowerCase();
    const chosen = select.value;
    const visible = all.filter(x => x.value === '' || x.value === NEW_PARTICIPANT_OPTION || needle === '' || x.haystack.indexOf(needle) !== -1);
    select.textContent = '';
    visible.forEach(x => {
      const option = document.createElement('option');
      option.value = x.value;
      option.textContent = x.label;
      const source = all.find(y => y.value === x.value);
      if (source != null) {
        option.setAttribute('data-name', nameFromLabel(source.label));
      }
      select.appendChild(option);
    });
    if (visible.some(x => x.value === chosen)) {
      select.value = chosen;
    }
  });
};

const nameFromLabel = label => {
  const text = String(label).trim();
  const separator = text.indexOf(NAME_SEPARATOR);
  return separator === -1 ? text : text.slice(0, separator);
};

const toggleNewBlock = (select, newBlock) => {
  if (newBlock == null) {
    return;
  }
  newBlock.hidden = select.value !== NEW_PARTICIPANT_OPTION;
};

const rememberParticipant = select => {
  if (select.value === '' || select.value === NEW_PARTICIPANT_OPTION) {
    return;
  }
  const option = select.options[select.selectedIndex];
  if (option == null) {
    return;
  }
  const stored = option.getAttribute('data-name');
  const label = option.textContent.trim();
  const separator = label.indexOf(NAME_SEPARATOR);
  writeStored(PARTICIPANT_KEY, {
    id: select.value,
    name: stored != null && stored !== '' ? stored : (separator === -1 ? label : label.slice(0, separator)),
  });
};

const setupLikes = () => {
  const forms = Array.from(document.querySelectorAll('[data-like-song]'));
  if (forms.length === 0) {
    return;
  }
  const participant = readStored(PARTICIPANT_KEY);
  forms.forEach(form => {
    if (participant != null && participant.name) {
      const nameInput = form.querySelector('input[name="name"]');
      if (nameInput != null) {
        nameInput.value = participant.name;
      }
    }
    form.addEventListener('submit', event => {
      sendLike(event, form);
    });
  });
};

const sendLike = (event, form) => {
  if (window.fetch == null || window.FormData == null) {
    return;
  }
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  if (button != null) {
    button.disabled = true;
  }
  window.fetch(form.action, {
    method: 'post',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    body: new URLSearchParams(new FormData(form)),
  }).then(response => {
    if (!response.ok) {
      throw new Error('like request failed');
    }
    return response.json();
  }).then(result => {
    if (button != null) {
      button.disabled = false;
    }
    applyLike(form, result);
  }).catch(() => {
    if (button != null) {
      button.disabled = false;
    }
    form.submit();
  });
};

const applyLike = (form, result) => {
  const songId = form.getAttribute('data-like-song');
  const voted = result.voted === true;
  form.setAttribute('data-like-action', voted ? 'unlike' : 'like');
  form.setAttribute('action', '/songs/' + encodeURIComponent(songId) + (voted ? '/unlike' : '/like'));
  const button = form.querySelector('button[type="submit"]');
  if (button != null) {
    button.classList.toggle('btn-primary', voted);
    button.classList.toggle('btn-outline-primary', !voted);
    button.title = voted ? 'Убрать свой голос' : '';
    const icon = button.querySelector('i');
    if (icon != null) {
      icon.classList.toggle('bi-heart-fill', voted);
      icon.classList.toggle('bi-heart', !voted);
    }
  }
  if (typeof result.likes !== 'number') {
    return;
  }
  Array.from(document.querySelectorAll('[data-like-count]'))
    .filter(x => x.getAttribute('data-like-count') === songId)
    .forEach(x => {
      writeLikeCount(x, String(result.likes));
    });
};

const writeLikeCount = (element, value) => {
  const icon = element.querySelector('i');
  if (icon == null) {
    element.textContent = value;
    return;
  }
  element.textContent = '';
  element.appendChild(icon);
  element.appendChild(document.createTextNode(' ' + value));
};

const setupPartners = () => {
  const container = document.querySelector('[data-partners]');
  const button = document.querySelector('[data-partners-add]');
  if (container == null || button == null) {
    return;
  }
  button.addEventListener('click', () => {
    if (container.children.length === 0) {
      return;
    }
    const row = container.children[0].cloneNode(true);
    row.querySelectorAll('input').forEach(x => {
      x.value = '';
    });
    container.appendChild(row);
  });
};

const setupRemember = () => {
  const marker = document.querySelector('[data-remember-id]');
  if (marker == null) {
    return;
  }
  const id = marker.getAttribute('data-remember-id');
  const name = marker.getAttribute('data-remember-name');
  if (id) {
    writeStored(PARTICIPANT_KEY, { id: id, name: name == null ? '' : name });
  }
};

const readStored = key => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const writeStored = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    return;
  }
};
