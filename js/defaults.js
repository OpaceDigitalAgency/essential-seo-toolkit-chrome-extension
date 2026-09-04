(function (global) {
  'use strict';

  var VERSION = 6;

  var categories = {
    '0': { id: '2', name: 'Performance & UX' },
    '1': { id: '5', name: 'Search appearance & markup' },
    '2': { id: '6', name: 'Accessibility' },
    '3': { id: '7', name: 'Technical & DNS' }
  };

  var sources = {
    'Google PageSpeed Insights': {
      url: 'https://pagespeed.web.dev/analysis?url=[%url_encoded%]',
      cat: '2',
      note: 'Performance and Core Web Vitals'
    },
    'Google Rich Results Test': {
      url: 'https://search.google.com/test/rich-results?url=[%url_encoded%]',
      cat: '5',
      note: 'Google-supported structured data'
    },
    'Schema Markup Validator': {
      url: 'https://validator.schema.org/#url=[%url_encoded%]',
      cat: '5',
      note: 'Schema.org vocabulary validation'
    },
    'WAVE Accessibility Evaluation': {
      url: 'https://wave.webaim.org/report#/[%url%]',
      cat: '6',
      note: 'Automated accessibility checks'
    },
    'Security Headers': {
      url: 'https://securityheaders.com/?q=[%host_encoded%]&followRedirects=on',
      cat: '7',
      note: 'HTTP response security headers'
    },
    'Google Admin Toolbox Dig': {
      url: 'https://toolbox.googleapps.com/apps/dig/#A/[%host_encoded%]',
      cat: '7',
      note: 'Live DNS A-record lookup'
    }
  };

  var legacyUrls = {
    'Alexa': 'https://www.alexa.com/siteinfo/[%host%]',
    'SE Ranking': 'https://online.seranking.com/login.html',
    'SEMRush': 'https://www.semrush.com/info/[%url%]',
    'Semrush Domain Overview': 'https://www.semrush.com/analytics/overview/?q=[%host%]&searchType=domain',
    'Pingdom Tools': 'https://tools.pingdom.com',
    'Pingdom Website Speed Test': 'https://tools.pingdom.com',
    'GT Metrix': 'https://gtmetrix.com/?url=[%url%]',
    'GTmetrix': 'https://gtmetrix.com/?url=[%url%]',
    'Google Page Speed Insights': 'https://developers.google.com/speed/pagespeed/insights/?url=[%url%]',
    'Google PageSpeed Insights': 'https://pagespeed.web.dev/analysis?url=[%url%]',
    'WooRank': 'https://www.woorank.com/en/www/[%host%]',
    'WooRank Website Review': 'https://www.woorank.com/en/www/[%host%]',
    'Nibbler': 'https://nibbler.silktide.com/',
    'SEOptimer': 'https://www.seoptimer.com/[%host%]',
    'SEOptimer Website Audit': 'https://www.seoptimer.com/[%host%]',
    'SiteChecker': 'https://sitechecker.pro/seo-report/[%url%]',
    'SEO Site Checkup': 'https://seositecheckup.com/seo-audit/[%host%]',
    'Majestic': 'https://majestic.com/reports/site-explorer?folder=&q=[%url%]&IndexDataSource=F',
    'Majestic Site Explorer': 'https://majestic.com/reports/site-explorer?folder=&q=[%url%]&IndexDataSource=F',
    'Ahrefs': 'https://ahrefs.com/site-explorer',
    'Ahrefs Site Explorer': 'https://ahrefs.com/site-explorer',
    'Moz Link Explorer': 'https://analytics.moz.com/pro/link-explorer/overview?site=[%url%]&target=domain',
    'Social Share Counter': 'https://sharescount.com/',
    'Count Checker': 'http://countchecker.com/',
    'Google Mobile-Friendly Test': 'https://search.google.com/test/mobile-friendly?url=[%url%]',
    'Think With Google Test': 'https://www.thinkwithgoogle.com/intl/en-gb/feature/testmysite/',
    'Responsinator': 'https://www.responsinator.com/?url=[%url%]',
    'BrowserStack Responsive Checker': 'https://www.browserstack.com/responsive?url=[%url%]',
    'XML Sitemap Generator': 'https://www.xml-sitemaps.com/',
    'Copyscape Duplicate Content Checke': 'https://www.copyscape.com/?q=[%url%]',
    'Copyscape Duplicate Content Checker': 'https://www.copyscape.com/?q=[%url%]',
    'Siteliner Crawler': 'http://www.siteliner.com/',
    'Siteliner Duplicate Content': 'https://www.siteliner.com/',
    'Google Structured Data Testing Tool': 'https://search.google.com/structured-data/testing-tool#url=[%url%]',
    'Google Rich Results Test': 'https://search.google.com/test/rich-results?url=[%url%]',
    'Schema Markup Validator': 'https://validator.schema.org/#url=[%url%]',
    'Security Headers': 'https://securityheaders.com/?q=[%url%]&followRedirects=on'
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function prepare(currentSources, currentCategories, currentVersion) {
    var nextSources = clone(currentSources || {});
    var nextCategories = clone(currentCategories || {});
    var changed = false;

    if (!Object.keys(nextCategories).length) {
      nextCategories = clone(categories);
      changed = true;
    }

    if (Number(currentVersion || 0) < VERSION) {
      Object.keys(legacyUrls).forEach(function (name) {
        if (nextSources[name] && nextSources[name].url === legacyUrls[name]) {
          delete nextSources[name];
          changed = true;
        }
      });

      Object.keys(sources).forEach(function (name) {
        if (!nextSources[name]) {
          nextSources[name] = clone(sources[name]);
          changed = true;
        }
      });

      Object.keys(categories).forEach(function (key) {
        var defaultCategory = categories[key];
        var existingKey = Object.keys(nextCategories).find(function (candidate) {
          return String(nextCategories[candidate].id) === defaultCategory.id;
        });

        if (existingKey === undefined) {
          nextCategories[key] = clone(defaultCategory);
          changed = true;
          return;
        }

        var oldNames = {
          '1': ['SEO & Traffic Analysis', 'Traffic & Competitive Research'],
          '2': ['Speed & Performance Analysis', 'Performance'],
          '3': ['Website & SEO Auditing'],
          '4': ['Backlink Analysis'],
          '5': ['Social Signals', 'Content & Structured Data', 'Search Appearance'],
          '6': ['User Experience', 'Accessibility & Mobile UX'],
          '7': ['Technical SEO', 'Technical Checks']
        };

        if (oldNames[defaultCategory.id].includes(nextCategories[existingKey].name)) {
          nextCategories[existingKey].name = defaultCategory.name;
          changed = true;
        }
      });

      var retiredEmptyCategories = {
        '1': ['SEO & Traffic Analysis', 'Traffic & Competitive Research', 'Research & Monitoring'],
        '3': ['Website & SEO Auditing', 'Website Auditing'],
        '4': ['Backlink Analysis', 'Backlinks & Authority']
      };
      Object.keys(nextCategories).forEach(function (key) {
        var category = nextCategories[key];
        var names = retiredEmptyCategories[String(category.id)];
        if (!names || !names.includes(category.name)) return;
        var categoryUsed = Object.keys(nextSources).some(function (sourceName) {
          return String(nextSources[sourceName].cat) === String(category.id);
        });
        if (!categoryUsed) {
          delete nextCategories[key];
          changed = true;
        }
      });
    }

    return {
      sources: nextSources,
      categories: nextCategories,
      version: VERSION,
      changed: changed || Number(currentVersion || 0) !== VERSION
    };
  }

  global.ESEOTDefaults = {
    version: VERSION,
    sources: clone(sources),
    categories: clone(categories),
    prepare: prepare
  };
})(globalThis);
