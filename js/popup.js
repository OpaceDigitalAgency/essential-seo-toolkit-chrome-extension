(function () {
  'use strict';

  var appState = { tab: null, page: null, sources: {}, categories: {}, checks: [], supportingRun: 0 };
  var CHECK_GROUPS = [
    { id: 'search', name: 'Search appearance' },
    { id: 'indexing', name: 'Indexing & delivery' },
    { id: 'content', name: 'Content & accessibility' },
    { id: 'markup', name: 'Markup & navigation' }
  ];

  document.addEventListener('DOMContentLoaded', initialise);

  async function initialise() {
    bindInterface();
    setAuditStatus('Preparing local audit…', 'loading');
    try {
      var data = await loadStoredData();
      appState.sources = data.sources;
      appState.categories = data.categories;
      appState.tab = await getActiveTab();
      renderCurrentPage(appState.tab);
      await waitForFirstPaint();
      await runAudit(appState.tab);
    } catch (error) {
      showAuditError(error.message || 'The current page could not be audited.');
    }
  }

  function waitForFirstPaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
  }

  function bindInterface() {
    document.querySelectorAll('[data-panel]').forEach(function (button) {
      button.addEventListener('click', function () { activatePanel(button.dataset.panel); });
    });
    document.getElementById('run-audit').addEventListener('click', function () {
      if (appState.tab) runAudit(appState.tab);
    });
    document.getElementById('copy-summary').addEventListener('click', copyAuditSummary);
    document.getElementById('copy-url').addEventListener('click', copyCurrentUrl);
    document.getElementById('run-crawl-check').addEventListener('click', runCrawlCheck);
    document.getElementById('run-accessibility-engine').addEventListener('click', runAccessibilityEngine);
    document.getElementById('run-web-vitals').addEventListener('click', runWebVitals);
    document.getElementById('open-settings').addEventListener('click', function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });
    document.getElementById('manage-links').addEventListener('click', function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html#sources') });
    });
    document.getElementById('manage-saved-tools').addEventListener('click', function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html#sources') });
    });
  }

  function activatePanel(panelName) {
    document.querySelectorAll('[data-panel]').forEach(function (button) {
      var selected = button.dataset.panel === panelName;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach(function (panel) {
      panel.hidden = panel.id !== panelName + '-panel';
    });
  }

  function loadStoredData() {
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

  function getActiveTab() {
    return new Promise(function (resolve, reject) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!tabs[0] || !tabs[0].url) return reject(new Error('Open the toolkit from a normal webpage to run an audit.'));
        resolve(tabs[0]);
      });
    });
  }

  function renderCurrentPage(tab) {
    var parsed = safeUrl(tab.url);
    var pageHost = document.getElementById('page-host');
    var pageTitle = document.getElementById('page-title');
    pageHost.textContent = parsed ? parsed.hostname.replace(/^www\./, '') : 'Unsupported page';
    pageTitle.textContent = tab.title || tab.url;
    pageTitle.title = tab.title || tab.url;
    document.getElementById('copy-url').disabled = !parsed;
  }

  async function runAudit(tab) {
    var parsed = safeUrl(tab.url);
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      showAuditError('Chrome protects this page. Open a public HTTP or HTTPS page and try again.');
      return;
    }
    setAuditStatus('Auditing this page locally…', 'loading');
    document.getElementById('run-audit').disabled = true;
    document.getElementById('audit-empty').hidden = true;
    try {
      var results = await executeAudit(tab.id);
      appState.page = results;
      appState.checks = buildChecks(results);
      renderAudit(results, appState.checks);
      renderInsights(results);
      renderOverview(results, appState.checks);
      renderTools(results, appState.checks);
      setAuditStatus('Audit complete', 'success');
      startSupportingChecks();
    } catch (error) {
      showAuditError(error.message || 'The page blocked the local audit.');
    } finally {
      document.getElementById('run-audit').disabled = false;
    }
  }

  function startSupportingChecks() {
    var runId = appState.supportingRun + 1;
    appState.supportingRun = runId;
    setTimeout(function () {
      if (appState.supportingRun === runId) runWebVitals();
    }, 100);
    setTimeout(function () {
      if (appState.supportingRun === runId) runCrawlCheck();
    }, 300);
    setTimeout(function () {
      if (appState.supportingRun === runId) runAccessibilityEngine();
    }, 650);
  }

  function executeAudit(tabId) {
    return new Promise(function (resolve, reject) {
      chrome.scripting.executeScript({ target: { tabId: tabId }, func: collectPageSignals }, function (results) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!results || !results[0] || !results[0].result) return reject(new Error('No audit data was returned by this page.'));
        resolve(results[0].result);
      });
    });
  }

  async function runAccessibilityEngine() {
    if (!appState.tab) return;
    var button = document.getElementById('run-accessibility-engine');
    var results = document.getElementById('accessibility-engine-results');
    setEngineLoading(button, results, 'Running axe-core locally…');
    setSupportingState('accessibility-engine-card', 'accessibility-summary-state', 'Analysing…', true);
    try {
      await injectFiles(appState.tab.id, ['vendor/axe-core/axe.min.js']);
      var data = await executeInTab(appState.tab.id, collectAxeViolations);
      renderAccessibilityResults(data);
      button.textContent = 'Refresh';
    } catch (error) {
      renderEngineError(results, error.message || 'The accessibility engine was unavailable.');
      setSupportingState('accessibility-engine-card', 'accessibility-summary-state', 'Unavailable', true);
      button.textContent = 'Try again';
    } finally {
      button.disabled = false;
    }
  }

  async function collectAxeViolations() {
    try {
      if (!globalThis.axe || typeof globalThis.axe.run !== 'function') {
        return { available: false, error: 'The bundled axe-core engine did not initialise.' };
      }
      var timeout = new Promise(function (_resolve, reject) {
        setTimeout(function () { reject(new Error('The page audit exceeded 8 seconds.')); }, 8000);
      });
      var audit = await Promise.race([
        globalThis.axe.run(document, { iframes: false, resultTypes: ['violations'] }),
        timeout
      ]);
      return {
        available: true,
        version: globalThis.axe.version || '',
        violations: (audit.violations || []).map(function (violation) {
          return {
            id: violation.id,
            impact: violation.impact || 'unknown',
            help: violation.help,
            description: violation.description || '',
            helpUrl: violation.helpUrl || '',
            nodeCount: (violation.nodes || []).length,
            targets: (violation.nodes || []).slice(0, 3).map(function (node) {
              return (node.target || []).join(' ');
            })
          };
        })
      };
    } catch (error) {
      return { available: false, error: error && error.message ? error.message : 'axe-core could not audit this page.' };
    }
  }

  function renderAccessibilityResults(data) {
    var container = document.getElementById('accessibility-engine-results');
    container.textContent = '';
    container.hidden = false;
    if (!data || !data.available) {
      renderEngineError(container, data && data.error ? data.error : 'Accessibility results were unavailable.');
      setSupportingState('accessibility-engine-card', 'accessibility-summary-state', 'Unavailable', true);
      return;
    }
    var violations = data.violations || [];
    setSupportingState('accessibility-engine-card', 'accessibility-summary-state', violations.length ? violations.length + ' issue' + (violations.length === 1 ? '' : 's') : 'No issues found', violations.length > 0);
    var nodeTotal = violations.reduce(function (total, violation) { return total + violation.nodeCount; }, 0);
    container.appendChild(createEngineSummary(
      violations.length ? violations.length + ' rule violation' + (violations.length === 1 ? '' : 's') : 'No rule violations found',
      violations.length ? nodeTotal + ' affected element' + (nodeTotal === 1 ? '' : 's') : 'Automated checks do not cover every accessibility requirement'
    ));
    violations.slice(0, 5).forEach(function (violation) {
      var row = createElement('div', 'engine-result');
      var heading = createElement('div', 'engine-result-heading');
      heading.append(
        createElement('strong', '', violation.help || violation.id),
        createElement('span', 'impact-badge impact-' + violation.impact, violation.impact)
      );
      var guidance = accessibilityGuidance(violation);
      row.append(
        heading,
        createElement('p', 'engine-result-count', violation.nodeCount + ' affected element' + (violation.nodeCount === 1 ? '' : 's')),
        createGuidanceBlock('Why it matters', guidance.why),
        createGuidanceBlock('What to do', guidance.fix)
      );
      if (violation.targets && violation.targets.length) {
        var technical = createElement('details', 'technical-detail');
        technical.append(createElement('summary', '', 'Technical detail'), createElement('code', 'engine-target', violation.targets.join(' · ')));
        if (violation.targets.some(function (target) { return /^#chrome_/i.test(target); })) {
          technical.appendChild(createElement('p', 'engine-note', 'This element may have been added by another browser extension. Confirm it in a clean profile before changing the page.'));
        }
        row.appendChild(technical);
      }
      container.appendChild(row);
    });
    if (violations.length > 5) container.appendChild(createElement('p', 'engine-note', (violations.length - 5) + ' more rule violation(s) are not shown here.'));
    container.appendChild(createElement('p', 'engine-note', 'axe-core ' + (data.version || '4.13.0') + ' ran locally. Embedded frames were excluded and automated findings still need human review.'));
  }

  function accessibilityGuidance(violation) {
    var guidance = {
      'region': ['Landmarks help screen-reader users understand and move around a page.', 'Place the page’s primary content inside a <main> element or another clearly labelled landmark.'],
      'landmark-one-main': ['A single main landmark tells assistive technology where the page’s central content begins.', 'Add one <main> element around the primary page content.'],
      'image-alt': ['Useful alternative text lets people understand meaningful images when they cannot see them.', 'Add concise alt text to meaningful images; use an empty alt attribute for purely decorative images.'],
      'button-name': ['Buttons need a clear accessible name so their purpose is announced.', 'Add visible text or an aria-label that describes what each button does.'],
      'link-name': ['Links need meaningful names so users know where they go.', 'Add descriptive link text or an accessible label; avoid empty and vague links.'],
      'color-contrast': ['Low contrast can make text unreadable for people with low vision.', 'Increase the contrast between the affected text and its background, then verify it again.'],
      'label': ['Form controls need labels so their purpose is announced.', 'Connect a visible label to each input, or add an equivalent accessible name.']
    };
    var match = guidance[violation.id];
    return {
      why: match ? match[0] : (violation.description || 'This automated rule found a pattern that may make the page harder to use.'),
      fix: match ? match[1] : 'Review the affected element, correct the underlying HTML and test the result with keyboard and screen-reader checks.'
    };
  }

  async function runWebVitals() {
    if (!appState.tab) return;
    var button = document.getElementById('run-web-vitals');
    var results = document.getElementById('web-vitals-results');
    setEngineLoading(button, results, 'Capturing this visit for up to 3 seconds…');
    setSupportingState('web-vitals-card', 'web-vitals-summary-state', 'Measuring…', true);
    try {
      await injectFiles(appState.tab.id, ['vendor/web-vitals/web-vitals.iife.js']);
      var data = await executeInTab(appState.tab.id, collectCurrentVisitVitals);
      renderWebVitalsResults(data);
      button.textContent = 'Refresh';
    } catch (error) {
      renderEngineError(results, error.message || 'Current-visit metrics were unavailable.');
      setSupportingState('web-vitals-card', 'web-vitals-summary-state', 'Unavailable', true);
      button.textContent = 'Try again';
    } finally {
      button.disabled = false;
    }
  }

  async function collectCurrentVisitVitals() {
    try {
      var library = globalThis.webVitals;
      if (!library || typeof library.onLCP !== 'function') {
        return { available: false, error: 'The bundled Web Vitals engine did not initialise.' };
      }
      var metrics = {};
      function record(metric) {
        metrics[metric.name] = {
          name: metric.name,
          value: metric.value,
          rating: metric.rating || 'unrated'
        };
      }
      library.onCLS(record, { reportAllChanges: true });
      library.onFCP(record, { reportAllChanges: true });
      library.onINP(record, { reportAllChanges: true });
      library.onLCP(record, { reportAllChanges: true });
      library.onTTFB(record, { reportAllChanges: true });
      await new Promise(function (resolve) { setTimeout(resolve, 2500); });
      return { available: true, version: '6.2.1', metrics: metrics };
    } catch (error) {
      return { available: false, error: error && error.message ? error.message : 'Web Vitals could not inspect this page load.' };
    }
  }

  function renderWebVitalsResults(data) {
    var container = document.getElementById('web-vitals-results');
    container.textContent = '';
    container.hidden = false;
    if (!data || !data.available) {
      renderEngineError(container, data && data.error ? data.error : 'Current-visit metrics were unavailable.');
      setSupportingState('web-vitals-card', 'web-vitals-summary-state', 'Unavailable', true);
      renderVitalSnapshot({});
      return;
    }
    var metrics = data.metrics || {};
    var names = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];
    var availableCount = names.filter(function (name) { return metrics[name]; }).length;
    var observed = names.filter(function (name) { return metrics[name]; });
    var poor = observed.filter(function (name) { return metrics[name].rating === 'poor'; });
    var needsWork = observed.filter(function (name) { return metrics[name].rating === 'needs-improvement'; });
    var summaryTitle = poor.length ? poor.length + ' slow metric' + (poor.length === 1 ? '' : 's') + ' in this visit' : needsWork.length ? needsWork.length + ' metric' + (needsWork.length === 1 ? '' : 's') + ' worth checking' : 'This visit looks responsive';
    setSupportingState('web-vitals-card', 'web-vitals-summary-state', poor.length ? poor.length + ' slow' : needsWork.length ? needsWork.length + ' to check' : 'Looks good', poor.length > 0 || needsWork.length > 0);
    container.appendChild(createEngineSummary(summaryTitle, availableCount + ' of ' + names.length + ' browser metrics captured'));
    var grid = createElement('div', 'vitals-grid');
    names.forEach(function (name) {
      var metric = metrics[name];
      var item = createElement('div', 'vital-metric');
      var label = vitalLabel(name);
      item.append(
        createElement('span', 'vital-name', label),
        createElement('strong', '', metric ? formatVitalMetric(name, metric.value) : 'Unavailable'),
        createElement('span', metric ? 'vital-rating rating-' + metric.rating : 'vital-rating', metric ? vitalRatingCopy(metric.rating) : name === 'INP' ? 'Use the page first' : 'Not observed')
      );
      grid.appendChild(item);
    });
    container.append(
      grid,
      createElement('p', 'engine-note', 'This is a current-visit diagnostic, not PageSpeed Insights field data or a ranking score. Confirm slow metrics with the recommended PageSpeed check below.')
    );
    renderVitalSnapshot(metrics);
  }

  function renderVitalSnapshot(metrics) {
    var container = document.getElementById('overview-vitals');
    container.textContent = '';
    container.appendChild(createElement('strong', 'overview-vitals-title', 'Current-visit performance'));
    var grid = createElement('div', 'overview-vitals-grid');
    ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].forEach(function (name) {
      var metric = metrics[name];
      var cell = createElement('div', 'overview-vital' + (metric ? ' rating-border-' + metric.rating : ''));
      cell.append(
        createElement('span', '', name),
        createElement('strong', '', metric ? formatVitalMetric(name, metric.value) : '—'),
        createElement('small', '', metric ? vitalRatingCopy(metric.rating) : 'Not observed')
      );
      grid.appendChild(cell);
    });
    container.append(grid, createElement('p', '', 'From this browser visit, not a PageSpeed or ranking score.'));
  }

  function vitalLabel(name) {
    return {
      LCP: 'Main content paint (LCP)',
      INP: 'Interaction response (INP)',
      CLS: 'Visual stability (CLS)',
      FCP: 'First visible content (FCP)',
      TTFB: 'Server response (TTFB)'
    }[name] || name;
  }

  function vitalRatingCopy(rating) {
    if (rating === 'good') return 'Good in this visit';
    if (rating === 'needs-improvement') return 'Worth checking';
    if (rating === 'poor') return 'Slow in this visit';
    return 'Not rated';
  }

  function injectFiles(tabId, files) {
    return new Promise(function (resolve, reject) {
      chrome.scripting.executeScript({ target: { tabId: tabId }, files: files }, function () {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve();
      });
    });
  }

  function executeInTab(tabId, func) {
    return new Promise(function (resolve, reject) {
      chrome.scripting.executeScript({ target: { tabId: tabId }, func: func }, function (results) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!results || !results[0]) return reject(new Error('The page returned no local result.'));
        resolve(results[0].result);
      });
    });
  }

  function setEngineLoading(button, container, message) {
    button.disabled = true;
    button.textContent = 'Working…';
    container.hidden = false;
    container.textContent = message;
  }

  function setSupportingState(cardId, stateId, text, open) {
    var card = document.getElementById(cardId);
    var state = document.getElementById(stateId);
    if (state) state.textContent = text;
    if (card) card.open = Boolean(open);
  }

  function renderEngineError(container, message) {
    container.hidden = false;
    container.textContent = '';
    container.appendChild(createElement('p', 'engine-error', 'Unavailable: ' + message));
  }

  function createEngineSummary(title, detail) {
    var summary = createElement('div', 'engine-summary');
    summary.append(createElement('strong', '', title), createElement('span', '', detail));
    return summary;
  }

  function formatVitalMetric(name, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
    if (name === 'CLS') return value.toFixed(3);
    return Math.round(value).toLocaleString() + ' ms';
  }

  function runCrawlCheck() {
    if (!appState.tab) return Promise.resolve();
    var button = document.getElementById('run-crawl-check');
    var results = document.getElementById('crawl-results');
    button.disabled = true;
    button.textContent = 'Checking…';
    results.hidden = false;
    results.textContent = 'Requesting same-origin crawl signals…';
    setSupportingState('crawl-card', 'crawl-summary-state', 'Checking…', true);
    return new Promise(function (resolve) {
      chrome.scripting.executeScript({ target: { tabId: appState.tab.id }, func: collectCrawlSignals }, function (executionResults) {
        button.disabled = false;
        button.textContent = 'Refresh';
        if (chrome.runtime.lastError || !executionResults || !executionResults[0]) {
          renderCrawlResults({ error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Crawl signals were unavailable.' });
          setSupportingState('crawl-card', 'crawl-summary-state', 'Unavailable', true);
          resolve();
          return;
        }
        renderCrawlResults(executionResults[0].result || { error: 'Crawl signals were unavailable.' });
        resolve();
      });
    });
  }

  async function collectCrawlSignals() {
    function headerValue(response, name) {
      return response && response.headers ? response.headers.get(name) || '' : '';
    }
    async function request(url, needsBody) {
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 8000);
      try {
        var response = await fetch(url, { method: needsBody ? 'GET' : 'HEAD', credentials: 'same-origin', redirect: 'follow', cache: 'no-store', signal: controller.signal });
        if (!needsBody && (response.status === 405 || response.status === 501)) {
          response = await fetch(url, { method: 'GET', credentials: 'same-origin', redirect: 'follow', cache: 'no-store', signal: controller.signal });
        }
        return {
          available: true,
          status: response.status,
          finalUrl: response.url,
          body: needsBody ? (await response.text()).substring(0, 250000) : '',
          headers: {
            contentType: headerValue(response, 'content-type'),
            xRobotsTag: headerValue(response, 'x-robots-tag'),
            cacheControl: headerValue(response, 'cache-control'),
            contentSecurityPolicy: headerValue(response, 'content-security-policy'),
            strictTransportSecurity: headerValue(response, 'strict-transport-security')
          }
        };
      } catch (error) {
        return { available: false, status: null, error: error && error.message ? error.message : 'Request unavailable', headers: {} };
      } finally {
        clearTimeout(timeout);
      }
    }
    var origin = location.origin;
    var responses = await Promise.all([request(location.href, false), request(origin + '/robots.txt', true), request(origin + '/sitemap.xml', false)]);
    var page = responses[0];
    var robots = responses[1];
    var sitemap = responses[2];
    var sitemapReferences = robots.body ? (robots.body.match(/^\s*sitemap\s*:\s*.+$/gim) || []).slice(0, 5) : [];
    return { page: page, robots: robots, sitemap: sitemap, sitemapReferences: sitemapReferences };
  }

  function renderCrawlResults(data) {
    var container = document.getElementById('crawl-results');
    container.textContent = '';
    if (data.error) {
      container.appendChild(createElement('p', '', 'Unavailable: ' + data.error));
      return;
    }
    var declaredSitemap = data.sitemapReferences && data.sitemapReferences.length ? data.sitemapReferences[0].replace(/^\s*sitemap\s*:\s*/i, '') : '';
    var crawlNeedsReview = !data.page || !data.page.available || data.page.status < 200 || data.page.status >= 400 || !data.robots || !data.robots.available || data.robots.status >= 400 || (!declaredSitemap && (!data.sitemap || data.sitemap.status >= 400));
    setSupportingState('crawl-card', 'crawl-summary-state', crawlNeedsReview ? 'Review needed' : 'Essentials reachable', crawlNeedsReview);
    container.append(
      createCrawlResult('Page response', requestStatus(data.page), data.page && data.page.available ? 'The current URL responded to the browser.' : 'The response could not be checked.', statusTone(data.page)),
      createCrawlResult('robots.txt', requestStatus(data.robots), declaredSitemap ? 'A sitemap is declared: ' + declaredSitemap : 'No sitemap declaration was found in robots.txt.', statusTone(data.robots)),
      createCrawlResult(declaredSitemap ? 'Default sitemap path' : 'sitemap.xml', data.sitemap && data.sitemap.status === 404 && declaredSitemap ? 'Not used' : requestStatus(data.sitemap), data.sitemap && data.sitemap.status === 404 && declaredSitemap ? 'That is fine because robots.txt points to another sitemap.' : 'Checked the conventional /sitemap.xml location.', data.sitemap && data.sitemap.status === 404 && declaredSitemap ? 'info' : statusTone(data.sitemap)),
      createCrawlResult('Response indexing rule', headerOrUnavailable(data.page, 'xRobotsTag') === 'Not exposed' ? 'No extra rule' : headerOrUnavailable(data.page, 'xRobotsTag'), 'No X-Robots-Tag normally means the page relies on its HTML robots setting.', 'info'),
      createCrawlResult('Browser caching', headerOrUnavailable(data.page, 'cacheControl') === 'Not exposed' ? 'No policy exposed' : 'Policy present', headerOrUnavailable(data.page, 'cacheControl'), headerOrUnavailable(data.page, 'cacheControl') === 'Not exposed' ? 'review' : 'good'),
      createCrawlResult('Security headers', securityHeaderSummary(data.page), 'CSP and HSTS visible to this request.', 'info')
    );
  }

  function createCrawlResult(label, value, detail, tone) {
    var row = createElement('div', 'crawl-result crawl-' + (tone || 'info'));
    row.append(createElement('strong', '', label), createElement('span', '', value || 'Unavailable'));
    if (detail) row.appendChild(createElement('p', '', detail));
    return row;
  }

  function requestStatus(result) {
    return result && result.available ? 'HTTP ' + result.status : 'Unavailable';
  }

  function statusTone(result) {
    return result && result.available && result.status >= 200 && result.status < 400 ? 'good' : 'review';
  }

  function headerOrUnavailable(result, key) {
    return result && result.available && result.headers && result.headers[key] ? result.headers[key] : 'Not exposed';
  }

  function securityHeaderSummary(result) {
    if (!result || !result.available || !result.headers) return 'Unavailable';
    return ['CSP ' + (result.headers.contentSecurityPolicy ? 'present' : 'not exposed'), 'HSTS ' + (result.headers.strictTransportSecurity ? 'present' : 'not exposed')].join(' · ');
  }

  function collectPageSignals() {
    function content(selector) {
      var element = document.querySelector(selector);
      return element ? (element.getAttribute('content') || '').trim() : '';
    }
    function href(selector) {
      var element = document.querySelector(selector);
      return element ? (element.href || element.getAttribute('href') || '').trim() : '';
    }
    function clean(value, limit) {
      return String(value || '').trim().replace(/\s+/g, ' ').substring(0, limit || 240);
    }
    function unique(values) {
      return Array.from(new Set(values));
    }
    function wordTokens(value) {
      var stopWords = new Set([
        'about', 'after', 'again', 'against', 'also', 'among', 'and', 'any', 'are', 'because', 'been', 'before', 'being', 'between',
        'both', 'but', 'can', 'could', 'did', 'does', 'doing', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
        'here', 'how', 'into', 'its', 'itself', 'just', 'more', 'most', 'not', 'now', 'only', 'other', 'our', 'ours', 'out', 'over',
        'own', 'same', 'should', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
        'those', 'through', 'too', 'under', 'until', 'very', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why',
        'will', 'with', 'would', 'you', 'your', 'yours', 'www', 'com', 'cookie', 'cookies', 'privacy'
      ]);
      var matches = clean(value, 250000).toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) || [];
      return matches.filter(function (word) { return !stopWords.has(word) && !/^\d+$/.test(word); });
    }
    function rankTerms(tokens, size, limit) {
      var counts = {};
      for (var index = 0; index <= tokens.length - size; index += 1) {
        var term = tokens.slice(index, index + size).join(' ');
        counts[term] = (counts[term] || 0) + 1;
      }
      return Object.keys(counts)
        .filter(function (term) { return counts[term] > (size === 1 ? 1 : 0); })
        .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); })
        .slice(0, limit)
        .map(function (term) { return { term: term, count: counts[term], size: size }; });
    }
    function collectOptionalAccessibilitySignals() {
      // Stable boundary for a future bundled local engine. No remote code is used.
      return { available: false, engine: null, issueCount: null };
    }
    var headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(function (heading) {
      return { level: Number(heading.tagName.substring(1)), text: (heading.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 180) };
    });
    var headingJumps = 0;
    headings.forEach(function (heading, index) {
      if (index > 0 && heading.level > headings[index - 1].level + 1) headingJumps += 1;
    });
    var images = Array.from(document.images);
    var missingAltImages = images.filter(function (image) { return !image.hasAttribute('alt'); });
    var links = Array.from(document.querySelectorAll('a[href]'));
    var internalLinks = [];
    var externalLinks = [];
    var nofollowLinks = 0;
    links.forEach(function (link) {
      try {
        var linkUrl = new URL(link.href, location.href);
        if (!/^https?:$/.test(linkUrl.protocol)) return;
        var item = { text: clean(link.textContent, 80) || '(no link text)', url: linkUrl.href.substring(0, 500) };
        if (linkUrl.hostname === location.hostname) internalLinks.push(item);
        else externalLinks.push(item);
        if ((link.rel || '').split(/\s+/).includes('nofollow')) nofollowLinks += 1;
      } catch (_error) { return; }
    });
    var schemaTypes = [];
    function collectSchemaTypes(item) {
      if (Array.isArray(item)) {
        item.forEach(collectSchemaTypes);
        return;
      }
      if (!item || typeof item !== 'object') return;
      if (item['@type']) {
        var types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        schemaTypes = schemaTypes.concat(types.map(String));
      }
      if (item['@graph']) collectSchemaTypes(item['@graph']);
    }
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (script) {
      try {
        collectSchemaTypes(JSON.parse(script.textContent));
      } catch (_error) { return; }
    });
    var visibleText = (document.body ? document.body.innerText : '').trim().replace(/\s+/g, ' ');
    var tokens = wordTokens(visibleText);
    var title = (document.title || '').trim();
    var description = content('meta[name="description" i]');
    var h1Text = headings.filter(function (heading) { return heading.level === 1; }).map(function (heading) { return heading.text; }).join(' ');
    var navigationEntry = performance.getEntriesByType('navigation')[0] || null;
    var resourceEntries = performance.getEntriesByType('resource') || [];
    var thirdPartyHosts = unique(resourceEntries.map(function (entry) {
      try {
        var resourceUrl = new URL(entry.name, location.href);
        return resourceUrl.hostname !== location.hostname ? resourceUrl.hostname : '';
      } catch (_error) { return ''; }
    }).filter(Boolean));
    return {
      url: location.href,
      protocol: location.protocol,
      title: title,
      description: description,
      canonical: href('link[rel="canonical" i]'),
      robots: content('meta[name="robots" i]'),
      language: (document.documentElement.lang || '').trim(),
      viewport: content('meta[name="viewport" i]'),
      h1: headings.filter(function (heading) { return heading.level === 1; }),
      headings: headings,
      headingJumps: headingJumps,
      imageCount: images.length,
      missingAltCount: missingAltImages.length,
      missingAltSamples: missingAltImages.slice(0, 5).map(function (image) {
        return clean(image.currentSrc || image.src || image.getAttribute('src'), 180) || '(image source unavailable)';
      }),
      internalLinks: internalLinks.length,
      externalLinks: externalLinks.length,
      nofollowLinks: nofollowLinks,
      internalLinkSamples: internalLinks.slice(0, 5),
      externalLinkSamples: externalLinks.slice(0, 5),
      wordCount: visibleText ? visibleText.split(/\s+/).length : 0,
      topTerms: rankTerms(tokens, 1, 8),
      topPhrases: rankTerms(tokens, 2, 6),
      termSets: { title: unique(wordTokens(title)), h1: unique(wordTokens(h1Text)), description: unique(wordTokens(description)) },
      schemaCount: document.querySelectorAll('script[type="application/ld+json"]').length,
      schemaTypes: Array.from(new Set(schemaTypes)),
      openGraphTitle: content('meta[property="og:title" i]'),
      openGraphDescription: content('meta[property="og:description" i]'),
      openGraphImage: content('meta[property="og:image" i]'),
      performance: {
        available: Boolean(navigationEntry),
        responseStartMs: navigationEntry ? Math.round(navigationEntry.responseStart) : null,
        domContentLoadedMs: navigationEntry ? Math.round(navigationEntry.domContentLoadedEventEnd) : null,
        loadCompleteMs: navigationEntry ? Math.round(navigationEntry.loadEventEnd) : null,
        transferBytes: resourceEntries.reduce(function (total, entry) { return total + (entry.transferSize || 0); }, navigationEntry ? navigationEntry.transferSize || 0 : 0),
        decodedBytes: resourceEntries.reduce(function (total, entry) { return total + (entry.decodedBodySize || 0); }, navigationEntry ? navigationEntry.decodedBodySize || 0 : 0),
        resourceCount: resourceEntries.length,
        thirdPartyHosts: thirdPartyHosts.slice(0, 12)
      },
      accessibility: collectOptionalAccessibilitySignals()
    };
  }

  function buildChecks(page) {
    var robots = page.robots.toLowerCase();
    var canonicalValid = safeUrl(page.canonical);
    var socialCount = [page.openGraphTitle, page.openGraphDescription, page.openGraphImage].filter(Boolean).length;
    return [
      lengthCheck('Page title', page.title, 15, 60, 'search', 'The title is a strong cue for search results and browser tabs.', 'Write a unique title that identifies the topic and purpose. Keep important wording near the start.'),
      lengthCheck('Meta description', page.description, 70, 160, 'search', 'Search engines may use this text as the result snippet when it fits the query.', 'Summarise the page accurately and give the searcher a concrete reason to click.'),
      check('H1 heading', page.h1.length === 1 ? 'pass' : 'review', page.h1.length + ' found', 'search', page.h1.length === 1 ? 'One clear H1 is present.' : 'Review pages with no H1 or multiple H1 headings.', 'A clear main heading identifies the primary page topic.', 'Use one descriptive main heading, then organise supporting sections beneath it.'),
      check('Canonical URL', canonicalValid ? 'pass' : 'review', canonicalValid ? page.canonical : 'Missing', 'indexing', canonicalValid ? 'A canonical link is declared.' : 'No canonical link was detected.', 'A canonical helps consolidate duplicate URLs around the preferred version.', 'Declare the absolute preferred URL and check that it returns 200 and is indexable.'),
      check('Indexing directive', robots.includes('noindex') ? 'review' : 'pass', page.robots || 'No noindex directive', 'indexing', robots.includes('noindex') ? 'This page asks search engines not to index it.' : 'No page-level noindex directive was found.', 'A noindex directive normally prevents the page appearing in search results.', robots.includes('noindex') ? 'Remove noindex only if this page is intended for public search. Also check X-Robots-Tag.' : 'No change is needed unless this page should be excluded.'),
      check('HTTPS', page.protocol === 'https:' ? 'pass' : 'review', page.protocol.replace(':', '').toUpperCase(), 'indexing', page.protocol === 'https:' ? 'The page uses HTTPS.' : 'The page is not using HTTPS.', 'HTTPS protects visitors and is expected for public pages.', 'Serve the canonical page over HTTPS, redirect HTTP and review response security headers.', ['Security Headers']),
      check('Document language', page.language ? 'pass' : 'review', page.language || 'Missing', 'content', page.language ? 'A document language is declared.' : 'No html lang value was detected.', 'The language attribute helps assistive technology interpret the page.', 'Add the appropriate BCP 47 code to html, such as lang="en-GB".', ['WAVE Accessibility Evaluation']),
      check('Mobile viewport', page.viewport ? 'pass' : 'review', page.viewport ? 'Present' : 'Missing', 'content', page.viewport ? 'A viewport directive is present.' : 'No responsive viewport directive was detected.', 'The viewport directive helps pages render correctly on mobile screens.', 'Add width=device-width and an initial scale, then test real mobile widths.', ['Google PageSpeed Insights']),
      check('Image alt attributes', page.missingAltCount === 0 ? 'pass' : 'review', page.missingAltCount + ' missing of ' + page.imageCount, 'content', page.missingAltCount ? 'Some images have no alt attribute.' : 'Every image has an alt attribute; empty alt may be correct for decoration.', 'Alt text makes meaningful images understandable when they cannot be seen.', 'Describe meaningful images. Give decorative images an empty alt rather than omitting it.', ['WAVE Accessibility Evaluation']),
      check('Heading order', page.headingJumps === 0 ? 'pass' : 'review', page.headingJumps + ' skipped level' + (page.headingJumps === 1 ? '' : 's'), 'content', page.headingJumps ? 'The outline skips one or more heading levels.' : 'No skipped heading levels were detected.', 'A logical outline lets readers and assistive technology scan the structure.', 'Nest headings by importance. Avoid jumps such as H2 directly to H4.', ['WAVE Accessibility Evaluation']),
      check('Page content', 'info', page.wordCount.toLocaleString() + ' visible words', 'content', 'This is a descriptive count, not a quality target.', 'Visible text reveals the topics and supporting detail available to readers.', 'Use Insights to review repeated terms and title–heading alignment. Edit only to improve usefulness.'),
      check('Structured data', 'info', page.schemaCount ? page.schemaTypes.join(', ') || page.schemaCount + ' block(s)' : 'None detected', 'markup', page.schemaCount ? page.schemaCount + ' JSON-LD block(s) detected.' : 'No JSON-LD structured data was detected.', 'Accurate markup can help eligible content qualify for enhanced presentation.', page.schemaCount ? 'Validate every detected type and confirm it describes visible content.' : 'Add schema only when a relevant type describes visible content.', ['Google Rich Results Test', 'Schema Markup Validator']),
      check('Social metadata', socialCount === 3 ? 'pass' : 'info', socialCount + ' of 3 Open Graph fields', 'markup', socialCount === 3 ? 'Title, description and image are present.' : 'One or more Open Graph fields are absent.', 'Platforms may use Open Graph fields to build a shared-link preview.', 'Set a concise title and description plus an absolute, crawlable image URL.'),
      check('Links', 'info', page.internalLinks + ' internal · ' + page.externalLinks + ' external', 'markup', page.nofollowLinks + ' link(s) use nofollow.', 'Links connect the page to related journeys and help crawlers discover resources.', 'Use descriptive anchor text and review nofollow values for the intended relationship.')
    ];
  }

  function lengthCheck(label, value, minimum, maximum, category, why, fix) {
    if (!value) return check(label, 'review', 'Missing', category, label + ' is missing.', why, fix);
    var length = value.length;
    var summary = length < minimum ? 'The wording may be too brief to communicate the page clearly.' : length > maximum ? 'The wording may be truncated in some displays.' : 'The length sits within a practical review range.';
    return check(label, length >= minimum && length <= maximum ? 'pass' : 'review', length + ' characters', category, summary, why, fix);
  }

  function check(label, status, value, category, summary, why, fix, tools) {
    return { label: label, status: status, value: value, category: category, summary: summary, why: why, fix: fix, tools: tools || [] };
  }

  function renderAudit(page, checks) {
    var list = document.getElementById('audit-results');
    list.textContent = '';
    CHECK_GROUPS.forEach(function (group) {
      var groupChecks = checks.filter(function (item) { return item.category === group.id; });
      if (!groupChecks.length) return;
      var section = createElement('section', 'audit-group');
      var heading = createElement('div', 'audit-group-heading');
      heading.append(createElement('h2', '', group.name), createElement('span', '', groupChecks.filter(function (item) { return item.status === 'review'; }).length + ' to review'));
      section.appendChild(heading);
      groupChecks.forEach(function (item) { section.appendChild(createAuditRow(item)); });
      list.appendChild(section);
    });
    document.getElementById('pass-count').textContent = checks.filter(function (item) { return item.status === 'pass'; }).length;
    document.getElementById('review-count').textContent = checks.filter(function (item) { return item.status === 'review'; }).length;
    document.getElementById('info-count').textContent = checks.filter(function (item) { return item.status === 'info'; }).length;
    document.getElementById('audit-summary').hidden = false;
    list.hidden = false;
    document.getElementById('copy-summary').disabled = false;
    document.getElementById('audited-url').textContent = page.url;
  }

  function renderOverview(page, checks) {
    var priority = document.getElementById('priority-results');
    var reviews = checks.filter(function (item) { return item.status === 'review'; });
    priority.textContent = '';
    document.getElementById('priority-count').textContent = reviews.length ? reviews.length + ' action' + (reviews.length === 1 ? '' : 's') : 'No common issues';
    if (!reviews.length) {
      var clear = createElement('div', 'all-clear-card');
      clear.append(
        createElement('span', 'all-clear-icon', '✓'),
        createElement('strong', '', 'No common on-page issue was flagged'),
        createElement('p', '', 'The automatic supporting checks below may still reveal accessibility, performance or delivery work.')
      );
      priority.appendChild(clear);
    } else {
      reviews.slice(0, 4).forEach(function (item, index) {
        var row = createAuditRow(item);
        row.classList.add('priority-row');
        row.open = index === 0;
        priority.appendChild(row);
      });
      if (reviews.length > 4) priority.appendChild(createElement('p', 'method-note', (reviews.length - 4) + ' more action(s) are listed under All details.'));
    }

    var overview = document.getElementById('overview-insights');
    overview.textContent = '';
    var structure = createElement('article', 'snapshot-card');
    structure.append(
      createElement('h3', '', 'Page structure'),
      createMetricGrid([
        [(page.headings || []).filter(function (heading) { return heading.level === 1; }).length, 'H1 headings'],
        [(page.headings || []).length, 'All headings'],
        [page.internalLinks || 0, 'Internal links'],
        [page.missingAltCount || 0, 'Images missing alt']
      ])
    );
    var outline = createElement('ol', 'outline-list snapshot-outline');
    (page.headings || []).slice(0, 5).forEach(function (heading) {
      var item = createElement('li');
      item.style.setProperty('--heading-level', String(Math.min(heading.level, 3)));
      item.append(createElement('strong', '', 'H' + heading.level + ' '), document.createTextNode(heading.text || '(empty heading)'));
      outline.appendChild(item);
    });
    if (!outline.childNodes.length) outline.appendChild(createElement('li', '', 'No headings detected.'));
    structure.appendChild(outline);
    overview.append(createSerpPreview(page), structure);
  }

  function createAuditRow(item) {
    var row = createElement('details', 'audit-row audit-' + item.status);
    var summary = createElement('summary', 'audit-summary-line');
    var marker = createElement('span', 'audit-marker');
    marker.setAttribute('aria-hidden', 'true');
    var copy = createElement('div', 'audit-summary-copy');
    var heading = createElement('div', 'audit-heading');
    heading.append(createElement('strong', '', item.label), createElement('span', '', item.value));
    copy.append(heading, createElement('p', '', item.summary));
    var chevron = createElement('span', 'audit-chevron', '⌄');
    chevron.setAttribute('aria-hidden', 'true');
    summary.append(marker, copy, chevron);
    var detail = createElement('div', 'audit-detail');
    detail.append(createGuidanceBlock('Why it matters', item.why), createGuidanceBlock('What to do', item.fix));
    if (item.tools.length) detail.appendChild(createVerifyActions(item.tools));
    row.append(summary, detail);
    return row;
  }

  function createGuidanceBlock(label, value) {
    var block = createElement('div', 'guidance-block');
    block.append(createElement('strong', '', label), createElement('p', '', value));
    return block;
  }

  function createVerifyActions(toolNames) {
    var actions = createElement('div', 'verify-actions');
    toolNames.forEach(function (toolName) {
      if (!appState.sources[toolName]) return;
      var button = createElement('button', 'verify-button', 'Verify with ' + shortToolName(toolName) + ' ↗');
      button.type = 'button';
      button.addEventListener('click', function () { openTool(toolName); });
      actions.appendChild(button);
    });
    return actions;
  }

  function renderInsights(page) {
    var container = document.getElementById('insight-groups');
    container.textContent = '';
    container.append(
      createInsightSection('Search wording', [createSerpPreview(page), createSocialPreview(page), createTermInsight(page), createOverlapInsight(page)]),
      createInsightSection('Page structure', [createHeadingInsight(page), createLinkInsight(page), createImageInsight(page), createSchemaInsight(page)]),
      createInsightSection('Browser performance snapshot', [createTimingInsight(page), createResourceInsight(page), createThirdPartyInsight(page)])
    );
  }

  function createInsightSection(title, cards) {
    var section = createElement('section', 'insight-section');
    section.appendChild(createElement('h3', '', title));
    cards.forEach(function (card) { section.appendChild(card); });
    return section;
  }

  function insightCard(title) {
    var card = createElement('article', 'insight-card');
    card.appendChild(createElement('h4', '', title));
    return card;
  }

  function createSerpPreview(page) {
    var card = insightCard('Search result preview');
    var preview = createElement('div', 'preview-card');
    preview.append(
      createElement('span', 'serp-title', page.title || 'Missing page title'),
      createElement('span', 'serp-url', page.url),
      createElement('span', 'serp-description', page.description || 'No meta description was detected for this page.')
    );
    card.append(preview, createElement('p', '', 'A local approximation. Search engines can choose different titles and snippets for each query.'));
    return card;
  }

  function createSocialPreview(page) {
    var card = insightCard('Shared-link preview');
    var preview = createElement('div', 'social-preview');
    preview.append(
      createElement('strong', '', page.openGraphTitle || page.title || 'No preview title'),
      createElement('span', '', page.openGraphDescription || page.description || 'No preview description detected'),
      createElement('span', '', page.openGraphImage ? 'Image set: ' + page.openGraphImage : 'No Open Graph image detected')
    );
    card.appendChild(preview);
    return card;
  }

  function createTermInsight(page) {
    var card = insightCard('Repeated terms and phrases');
    var list = createElement('div', 'term-list');
    (page.topTerms || []).concat(page.topPhrases || []).slice(0, 12).forEach(function (item) {
      var chip = createElement('span', 'term-chip');
      chip.append(document.createTextNode(item.term + ' '), createElement('strong', '', '×' + item.count));
      list.appendChild(chip);
    });
    if (!list.childNodes.length) list.appendChild(createElement('span', 'term-chip', 'Not enough visible text'));
    card.append(list, createElement('p', '', 'Frequency from visible page text only. These are not target keywords, search volumes or ranking recommendations.'));
    return card;
  }

  function createOverlapInsight(page) {
    var card = insightCard('Title, H1 and description overlap');
    var sets = page.termSets || {};
    var pairs = [
      { label: 'Title ↔ H1', terms: intersection(sets.title, sets.h1) },
      { label: 'Title ↔ description', terms: intersection(sets.title, sets.description) },
      { label: 'Across all 3', terms: intersection(intersection(sets.title, sets.h1), sets.description) }
    ];
    var grid = createElement('div', 'overlap-grid');
    pairs.forEach(function (pair) {
      var cell = createElement('div', 'overlap-cell');
      cell.append(createElement('strong', '', String(pair.terms.length)), createElement('span', '', pair.label));
      grid.appendChild(cell);
    });
    var shared = pairs[2].terms.slice(0, 8);
    card.append(grid, createElement('p', '', shared.length ? 'Shared terms: ' + shared.join(', ') : 'No meaningful term appears in all three fields. Exact repetition is not required.'));
    return card;
  }

  function createHeadingInsight(page) {
    var card = insightCard('Heading outline');
    var list = createElement('ol', 'outline-list');
    (page.headings || []).slice(0, 12).forEach(function (heading) {
      var item = createElement('li');
      item.style.setProperty('--heading-level', String(heading.level));
      item.append(createElement('strong', '', 'H' + heading.level + ' '), document.createTextNode(heading.text || '(empty heading)'));
      list.appendChild(item);
    });
    if (!list.childNodes.length) list.appendChild(createElement('li', '', 'No headings detected.'));
    card.appendChild(list);
    if ((page.headings || []).length > 12) card.appendChild(createElement('p', '', (page.headings.length - 12) + ' more heading(s) not shown.'));
    return card;
  }

  function createLinkInsight(page) {
    var card = insightCard('Link inventory');
    card.appendChild(createMetricGrid([[page.internalLinks, 'Internal'], [page.externalLinks, 'External'], [page.nofollowLinks, 'Nofollow']]));
    var samples = createElement('ul', 'sample-list');
    (page.internalLinkSamples || []).slice(0, 2).concat((page.externalLinkSamples || []).slice(0, 2)).forEach(function (link) {
      var item = createElement('li', '', link.text + ' — ' + link.url);
      item.title = link.url;
      samples.appendChild(item);
    });
    if (samples.childNodes.length) card.append(createElement('p', '', 'Sample links'), samples);
    return card;
  }

  function createImageInsight(page) {
    var card = insightCard('Images and alt coverage');
    card.appendChild(createMetricGrid([[page.imageCount, 'Images'], [page.imageCount - page.missingAltCount, 'With alt attribute'], [page.missingAltCount, 'Missing alt']]));
    if (page.missingAltSamples && page.missingAltSamples.length) {
      var list = createElement('ul', 'sample-list');
      page.missingAltSamples.forEach(function (source) { list.appendChild(createElement('li', '', source)); });
      card.append(createElement('p', '', 'Missing-alt image sources'), list);
    } else {
      card.appendChild(createElement('p', '', 'No image without an alt attribute was found. Empty alt may be correct for decorative images.'));
    }
    return card;
  }

  function createSchemaInsight(page) {
    var card = insightCard('Structured data summary');
    card.appendChild(createMetricGrid([[page.schemaCount, 'JSON-LD blocks'], [(page.schemaTypes || []).length, 'Detected types']]));
    card.appendChild(createElement('p', '', page.schemaTypes && page.schemaTypes.length ? page.schemaTypes.join(', ') : 'No JSON-LD types detected. Add markup only when it describes visible content accurately.'));
    return card;
  }

  function createMetricGrid(items) {
    var grid = createElement('div', 'metric-grid');
    items.forEach(function (item) {
      var metric = createElement('div', 'metric');
      metric.append(createElement('strong', '', String(item[0])), createElement('span', '', item[1]));
      grid.appendChild(metric);
    });
    return grid;
  }

  function createTimingInsight(page) {
    var data = page.performance || {};
    var card = insightCard('Navigation timing');
    card.appendChild(createMetricGrid([
      [formatMilliseconds(data.responseStartMs), 'Response started'],
      [formatMilliseconds(data.domContentLoadedMs), 'DOM content loaded'],
      [formatMilliseconds(data.loadCompleteMs), 'Load event']
    ]));
    card.appendChild(createElement('p', '', 'A snapshot from this visit, affected by device, cache and connection. It is not a Core Web Vitals field report.'));
    return card;
  }

  function createResourceInsight(page) {
    var data = page.performance || {};
    var card = insightCard('Loaded resources');
    card.appendChild(createMetricGrid([
      [data.resourceCount == null ? 'Unavailable' : data.resourceCount, 'Resource requests'],
      [formatBytes(data.transferBytes), 'Transferred'],
      [formatBytes(data.decodedBytes), 'Decoded size']
    ]));
    card.appendChild(createElement('p', '', 'Cached and cross-origin resources can report zero sizes, so treat these figures as a diagnostic snapshot.'));
    return card;
  }

  function createThirdPartyInsight(page) {
    var hosts = page.performance && page.performance.thirdPartyHosts || [];
    var card = insightCard('Third-party resource hosts');
    card.appendChild(createElement('p', '', hosts.length ? hosts.length + ' external host(s) supplied resources during this load.' : 'No third-party host was exposed by browser timing data.'));
    if (hosts.length) {
      var list = createElement('div', 'term-list');
      hosts.forEach(function (host) { list.appendChild(createElement('span', 'term-chip', host)); });
      card.appendChild(list);
    }
    return card;
  }

  function renderTools(page, checks) {
    var container = document.getElementById('tool-groups');
    container.textContent = '';
    var reviewCount = checks.filter(function (item) { return item.status === 'review'; }).length;
    document.getElementById('action-intro').textContent = reviewCount
      ? reviewCount + ' local item' + (reviewCount === 1 ? '' : 's') + ' need review. These deeper checks are ordered by relevance.'
      : 'No common local issue was flagged. These checks cover evidence the page DOM cannot provide.';

    var contexts = Object.keys(ESEOTDefaults.sources).map(function (name) { return toolContext(name, page, checks); });
    contexts.sort(function (a, b) { return Number(b.priority) - Number(a.priority) || a.name.localeCompare(b.name); });
    var builtInSection = createElement('section', 'tool-group');
    builtInSection.appendChild(createElement('h3', '', 'Recommended for this page'));
    contexts.slice(0, 3).forEach(function (context) {
      if (appState.sources[context.name]) builtInSection.appendChild(createToolLink(context.name, appState.sources[context.name], context));
    });
    var remaining = contexts.slice(3).filter(function (context) { return appState.sources[context.name]; });
    if (remaining.length) {
      var more = createElement('details', 'more-tools');
      more.appendChild(createElement('summary', '', remaining.length + ' more optional checks'));
      remaining.forEach(function (context) { more.appendChild(createToolLink(context.name, appState.sources[context.name], context)); });
      builtInSection.appendChild(more);
    }
    container.appendChild(builtInSection);

    Object.keys(appState.categories).forEach(function (categoryKey) {
      var category = appState.categories[categoryKey];
      var tools = Object.keys(appState.sources).filter(function (name) {
        return !ESEOTDefaults.sources[name] && String(appState.sources[name].cat) === String(category.id);
      });
      if (!tools.length) return;
      var section = createElement('section', 'tool-group');
      section.appendChild(createElement('h3', '', category.name + ' · custom'));
      tools.forEach(function (name) {
        section.appendChild(createToolLink(name, appState.sources[name], {
          priority: false, tag: 'Custom deeper check', reason: appState.sources[name].note || 'Your saved page-aware deeper check.'
        }));
      });
      container.appendChild(section);
    });
    renderSavedTools();
  }

  function renderSavedTools() {
    var container = document.getElementById('saved-tool-groups');
    container.textContent = '';
    Object.keys(appState.categories).forEach(function (categoryKey) {
      var category = appState.categories[categoryKey];
      var names = Object.keys(appState.sources).filter(function (name) {
        return String(appState.sources[name].cat) === String(category.id);
      }).sort(function (a, b) { return a.localeCompare(b); });
      if (!names.length) return;
      var section = createElement('section', 'saved-tool-group');
      section.appendChild(createElement('h3', '', category.name));
      var links = createElement('div', 'saved-tool-list');
      names.forEach(function (name) { links.appendChild(createSavedToolLink(name, appState.sources[name])); });
      section.appendChild(links);
      container.appendChild(section);
    });
    if (!container.childNodes.length) container.appendChild(createElement('p', 'loading-card', 'No saved tools yet. Open Settings to add a page-aware link.'));
  }

  function createSavedToolLink(name, source) {
    var destination = generateToolUrl(source.url, appState.tab.url);
    var link = createElement('a', 'saved-tool-link');
    link.href = destination || '#';
    link.target = '_blank';
    link.rel = 'noopener';
    link.append(
      createElement('strong', '', name),
      createElement('span', '', ESEOTDefaults.sources[name] ? 'Built-in · ready for this page' : 'Your saved tool · ready for this page'),
      createElement('span', 'saved-tool-arrow', '↗')
    );
    link.addEventListener('click', function (event) {
      event.preventDefault();
      if (destination) chrome.tabs.create({ url: destination });
    });
    return link;
  }

  function toolContext(name, page, checks) {
    var reviewLabels = checks.filter(function (item) { return item.status === 'review'; }).map(function (item) { return item.label; });
    var performanceData = page.performance || {};
    var heavierPage = (performanceData.loadCompleteMs || 0) > 3000 || (performanceData.transferBytes || 0) > 2500000 || (performanceData.resourceCount || 0) > 100;
    var accessibilityReviews = ['Document language', 'Image alt attributes', 'Heading order'].filter(function (label) { return reviewLabels.includes(label); });
    var contexts = {
      'Google PageSpeed Insights': { priority: heavierPage || reviewLabels.includes('Mobile viewport'), tag: heavierPage ? 'Performance follow-up' : 'Field & lab data', reason: heavierPage ? 'The local snapshot looks relatively heavy or slow. Measure Core Web Vitals and diagnostics for this URL.' : 'Measure performance and Core Web Vitals that a local DOM audit cannot confirm.' },
      'Google Rich Results Test': { priority: page.schemaCount > 0, tag: page.schemaCount > 0 ? 'Validate detected markup' : 'Eligibility check', reason: page.schemaCount > 0 ? 'Check whether the detected ' + (page.schemaTypes.join(', ') || 'structured data') + ' is eligible for rich results.' : 'Use after adding an eligible structured-data type; no JSON-LD block was detected.' },
      'Schema Markup Validator': { priority: page.schemaCount > 0, tag: page.schemaCount > 0 ? page.schemaCount + ' block(s) detected' : 'Vocabulary check', reason: page.schemaCount > 0 ? 'Validate this page’s Schema.org syntax and vocabulary.' : 'Use after adding structured data to validate its syntax and vocabulary.' },
      'WAVE Accessibility Evaluation': { priority: accessibilityReviews.length > 0, tag: accessibilityReviews.length ? accessibilityReviews.length + ' related review(s)' : 'Broader accessibility check', reason: accessibilityReviews.length ? 'Investigate the local ' + accessibilityReviews.join(', ').toLocaleLowerCase() + ' findings in a broader evaluation.' : 'Check contrast, labels, landmarks and other issues beyond the local signal set.' },
      'Security Headers': { priority: page.protocol !== 'https:', tag: 'Response headers', reason: 'Inspect live HTTP security headers that are not exposed by the page DOM.' },
      'Google Admin Toolbox Dig': { priority: false, tag: 'DNS evidence', reason: 'Confirm the current host’s live A records when diagnosing domain or delivery changes.' }
    };
    return Object.assign({ name: name, priority: false, tag: 'Deeper check', reason: 'Continue reviewing this page.' }, contexts[name] || {});
  }

  function createToolLink(name, source, context) {
    var destination = generateToolUrl(source.url, appState.tab.url);
    var link = createElement('a', 'tool-link' + (context.priority ? ' is-priority' : ''));
    link.href = destination || '#';
    link.target = '_blank';
    link.rel = 'noopener';
    link.append(createElement('span', 'tool-tag', context.tag), createElement('strong', '', name), createElement('span', 'tool-reason', context.reason), createElement('span', '', source.note || 'Page-aware deeper check'));
    var arrow = createElement('span', 'tool-arrow', '↗');
    arrow.setAttribute('aria-hidden', 'true');
    link.appendChild(arrow);
    link.addEventListener('click', function (event) {
      event.preventDefault();
      if (destination) chrome.tabs.create({ url: destination });
    });
    return link;
  }

  function openTool(name) {
    var source = appState.sources[name];
    if (!source || !appState.tab) return;
    var destination = generateToolUrl(source.url, appState.tab.url);
    if (destination) chrome.tabs.create({ url: destination });
  }

  function generateToolUrl(template, pageUrl) {
    var page = safeUrl(pageUrl);
    if (!page || typeof template !== 'string') return null;
    var host = page.hostname.replace(/^www\./, '');
    var destination = template
      .replaceAll('[%url_encoded%]', encodeURIComponent(page.href))
      .replaceAll('[%host_encoded%]', encodeURIComponent(host))
      .replaceAll('[%url%]', page.href)
      .replaceAll('[%host%]', host);
    var parsed = safeUrl(destination);
    return parsed && /^https?:$/.test(parsed.protocol) ? parsed.href : null;
  }

  async function copyCurrentUrl() {
    if (!appState.tab || !safeUrl(appState.tab.url)) return;
    await copyText(appState.tab.url);
    flashButton(document.getElementById('copy-url'), 'Copied');
  }

  async function copyAuditSummary() {
    if (!appState.page || !appState.checks.length) return;
    var lines = ['Essential SEO Toolkit local audit', appState.page.url, ''];
    appState.checks.forEach(function (item) {
      lines.push(item.status.toUpperCase() + ' · ' + item.label + ': ' + item.value);
      if (item.status === 'review') lines.push('  Action: ' + item.fix);
    });
    lines.push('', 'Automated checks are prompts for review, not ranking guarantees.');
    await copyText(lines.join('\n'));
    flashButton(document.getElementById('copy-summary'), 'Summary copied');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var temporary = document.createElement('textarea');
    temporary.value = text;
    document.body.appendChild(temporary);
    temporary.select();
    document.execCommand('copy');
    temporary.remove();
    return Promise.resolve();
  }

  function flashButton(button, message) {
    var original = button.textContent;
    button.textContent = message;
    setTimeout(function () { button.textContent = original; }, 1400);
  }

  function setAuditStatus(message, state) {
    var status = document.getElementById('audit-status');
    status.textContent = message;
    status.dataset.state = state;
  }

  function showAuditError(message) {
    setAuditStatus(message, 'error');
    var empty = document.getElementById('audit-empty');
    empty.hidden = false;
    empty.textContent = message;
  }

  function createElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function shortToolName(name) {
    var names = {
      'Google PageSpeed Insights': 'PageSpeed',
      'Google Rich Results Test': 'Rich Results',
      'Schema Markup Validator': 'Schema Validator',
      'WAVE Accessibility Evaluation': 'WAVE'
    };
    return names[name] || name;
  }

  function intersection(first, second) {
    return (first || []).filter(function (value) { return (second || []).includes(value); });
  }

  function formatMilliseconds(value) {
    return value == null || value <= 0 ? 'Unavailable' : value.toLocaleString() + ' ms';
  }

  function formatBytes(value) {
    if (value == null || value <= 0) return 'Unavailable';
    if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB';
    return Math.round(value / 1024).toLocaleString() + ' KB';
  }

  function safeUrl(value) {
    try { return new URL(value); } catch (_error) { return null; }
  }
})();
