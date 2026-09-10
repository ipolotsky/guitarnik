const PARTICIPANT_KEY = 'guitarnik.participant';

const NEW_PARTICIPANT_OPTION = '__new__';

const NAME_SEPARATOR = ' - ';

document.addEventListener('DOMContentLoaded', () => {
  setupWho();
  setupLikes();
  setupPicker();
  setupPartners();
  setupRemember();
});

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
      chip.textContent = `${box.getAttribute('data-name')} ×`;
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
  const stored = readStored(PARTICIPANT_KEY);
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
  const label = option.textContent.trim();
  const separator = label.indexOf(NAME_SEPARATOR);
  writeStored(PARTICIPANT_KEY, {
    id: select.value,
    name: separator === -1 ? label : label.slice(0, separator),
  });
};

const setupLikes = () => {
  const forms = document.querySelectorAll('[data-like-song]');
  if (forms.length === 0) {
    return;
  }
  const participant = readStored(PARTICIPANT_KEY);
  if (participant == null || !participant.name) {
    return;
  }
  forms.forEach(form => {
    const nameInput = form.querySelector('input[name="name"]');
    if (nameInput != null) {
      nameInput.value = participant.name;
    }
  });
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
