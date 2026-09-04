(function () {
  'use strict';

  var sources = {};
  var categories = {};

  document.addEventListener('DOMContentLoaded', initialise);

  async function initialise() {
    bindInterface();
    try {
      var prepared = await loadData();
      sources = prepared.sources;
      categories = prepared.categories;
      renderAll();
    } catch (error) {
      showNotice(error.message || 'Settings could not be loaded.', 'error');
    }
  }

  function bindInterface() {
    document.querySelectorAll('[data-tab]').forEach(function (button) {
      button.addEventListener('click', function () { activateTab(button.dataset.tab); });
    });
    document.getElementById('source-form').addEventListener('submit', saveSource);
    document.getElementById('category-form').addEventListener('submit', saveCategory);
    document.getElementById('restore-built-ins').addEventListener('click', restoreBuiltIns);
  }

  function activateTab(tabName) {
    document.querySelectorAll('[data-tab]').forEach(function (button) {
      var selected = button.dataset.tab === tabName;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) {
      panel.hidden = panel.id !== tabName;
    });
  }

  function loadData() {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(['eseot_sources', 'eseot_categories', 'eseot_defaults_version'], function (stored) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        var prepared = ESEOTDefaults.prepare(stored.eseot_sources, stored.eseot_categories, stored.eseot_defaults_version);
        if (!prepared.changed) return resolve(prepared);
        chrome.storage.local.set({
          eseot_sources: prepared.sources,
          eseot_categories: prepared.categories,
          eseot_defaults_version: prepared.version
        }, function () {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(prepared);
        });
      });
    });
  }

  function persist() {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.set({
        eseot_sources: sources,
        eseot_categories: categories,
        eseot_defaults_version: ESEOTDefaults.version
      }, function () {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve();
      });
    });
  }

  function renderAll() {
    renderSources();
    renderCategories();
    renderCategorySelect();
  }

  function renderSources() {
    var body = document.getElementById('sources-body');
    body.textContent = '';
    Object.keys(sources).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (name) {
      var source = sources[name];
      var row = document.createElement('tr');
      var nameCell = document.createElement('td');
      var title = document.createElement('strong');
      title.textContent = name;
      var badge = document.createElement('span');
      badge.className = 'badge ' + (ESEOTDefaults.sources[name] ? 'badge-built-in' : 'badge-custom');
      badge.textContent = ESEOTDefaults.sources[name] ? 'Built-in free' : 'Custom';
      nameCell.append(title, badge);
      var urlCell = document.createElement('td');
      var code = document.createElement('code');
      code.textContent = source.url;
      urlCell.appendChild(code);
      var categoryCell = document.createElement('td');
      var categoryTitle = document.createElement('strong');
      categoryTitle.textContent = categoryName(source.cat);
      var placement = document.createElement('small');
      placement.className = 'placement-note';
      placement.textContent = 'Used in popup recommendations';
      categoryCell.append(categoryTitle, placement);
      var actionCell = document.createElement('td');
      var remove = document.createElement('button');
      remove.className = 'delete-button';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', function () { removeSource(name); });
      actionCell.appendChild(remove);
      row.append(nameCell, urlCell, categoryCell, actionCell);
      body.appendChild(row);
    });
  }

  function renderCategories() {
    var body = document.getElementById('categories-body');
    body.textContent = '';
    Object.keys(categories).sort(function (a, b) { return Number(categories[a].id) - Number(categories[b].id); }).forEach(function (key) {
      var category = categories[key];
      var count = Object.keys(sources).filter(function (name) { return String(sources[name].cat) === String(category.id); }).length;
      var row = document.createElement('tr');
      var nameCell = document.createElement('td');
      nameCell.textContent = category.name;
      var countCell = document.createElement('td');
      countCell.textContent = count;
      var actionCell = document.createElement('td');
      var remove = document.createElement('button');
      remove.className = 'delete-button';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.disabled = count > 0;
      remove.title = count > 0 ? 'Remove or move this group’s links first.' : 'Remove link group';
      remove.addEventListener('click', function () { removeCategory(key); });
      actionCell.appendChild(remove);
      row.append(nameCell, countCell, actionCell);
      body.appendChild(row);
    });
  }

  function renderCategorySelect() {
    var select = document.getElementById('source-category');
    var selected = select.value;
    select.textContent = '';
    Object.keys(categories).sort(function (a, b) { return Number(categories[a].id) - Number(categories[b].id); }).forEach(function (key) {
      var option = document.createElement('option');
      option.value = categories[key].id;
      option.textContent = categories[key].name;
      select.appendChild(option);
    });
    if (selected) select.value = selected;
  }

  async function saveSource(event) {
    event.preventDefault();
    var name = document.getElementById('source-name').value.trim();
    var template = document.getElementById('source-url').value.trim();
    var category = document.getElementById('source-category').value;
    if (!name || !validTemplate(template)) {
      showNotice('Enter a name and an HTTP or HTTPS URL template. Only the four documented placeholders are allowed.', 'error');
      return;
    }
    sources[name] = { url: template, cat: category, note: 'Custom deeper check' };
    await persist();
    event.target.reset();
    renderAll();
    showNotice('Deeper-check link saved. It will appear in the popup recommendations.', 'success');
  }

  async function saveCategory(event) {
    event.preventDefault();
    var name = document.getElementById('category-name').value.trim();
    if (!name) return;
    var ids = Object.keys(categories).map(function (key) { return Number(categories[key].id); });
    var id = String((ids.length ? Math.max.apply(Math, ids) : 0) + 1);
    var key = String(Date.now());
    categories[key] = { id: id, name: name };
    await persist();
    event.target.reset();
    renderAll();
    showNotice('Link group added.', 'success');
  }

  async function removeSource(name) {
    delete sources[name];
    await persist();
    renderAll();
    showNotice('Deeper-check link removed. You can restore built-ins at any time.', 'success');
  }

  async function removeCategory(key) {
    delete categories[key];
    await persist();
    renderAll();
    showNotice('Link group removed.', 'success');
  }

  async function restoreBuiltIns() {
    var restored = 0;
    Object.keys(ESEOTDefaults.sources).forEach(function (name) {
      if (!sources[name]) {
        sources[name] = JSON.parse(JSON.stringify(ESEOTDefaults.sources[name]));
        restored += 1;
      }
    });
    await persist();
    renderAll();
    showNotice(restored ? restored + ' built-in deeper check(s) restored.' : 'All built-in deeper checks are already present.', 'success');
  }

  function categoryName(id) {
    var key = Object.keys(categories).find(function (candidate) { return String(categories[candidate].id) === String(id); });
    return key === undefined ? 'Uncategorised' : categories[key].name;
  }

  function validTemplate(template) {
    if (/\[%[^%]+%\]/.test(template.replace(/\[%(url|host|url_encoded|host_encoded)%\]/g, ''))) return false;
    var candidate = template
      .replaceAll('[%url_encoded%]', encodeURIComponent('https://example.com/'))
      .replaceAll('[%host_encoded%]', 'example.com')
      .replaceAll('[%url%]', 'https://example.com/')
      .replaceAll('[%host%]', 'example.com');
    try {
      var parsed = new URL(candidate);
      return /^https?:$/.test(parsed.protocol);
    } catch (_error) {
      return false;
    }
  }

  function showNotice(message, type) {
    var notice = document.getElementById('notice');
    notice.textContent = message;
    notice.className = 'notice notice-' + type;
    notice.hidden = false;
    clearTimeout(showNotice.timeout);
    showNotice.timeout = setTimeout(function () { notice.hidden = true; }, 4500);
  }
})();
