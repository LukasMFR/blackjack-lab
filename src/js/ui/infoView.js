import { t } from '../i18n/index.js';
import { APP_VERSION } from '../version.js';

/**
 * Content of the "Information & legal" page inside the settings dialog.
 * Every statement here reflects the actual implementation: storage behaviour
 * from ui/storage.js and ui/sessionStore.js, asset provenance and licences
 * from src/assets/ASSETS.md, and the repository from the project remote.
 */

const REPO_URL = 'https://github.com/LukasMFR/blackjack-lab';
const REPO_LABEL = 'github.com/LukasMFR/blackjack-lab';
const GITHUB_PAGES_PRIVACY_URL = 'https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection';

/*
 * Third-party credits. The descriptive sentence is translated; creator and
 * licence names are proper nouns and stay as published. URLs are the source
 * and licence links documented in src/assets/ASSETS.md.
 */
const CREDITS = [
  {
    bodyKey: 'info.creditFont',
    links: [
      { label: 'Marcellus, Google Fonts', url: 'https://fonts.google.com/specimen/Marcellus' },
      { label: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org' },
    ],
  },
  {
    bodyKey: 'info.creditMusic',
    noteKey: 'info.creditMusicAttribution',
    links: [
      { label: 'incompetech.com', url: 'https://incompetech.com' },
      { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    ],
  },
  {
    bodyKey: 'info.creditCasinoSfx',
    links: [
      { label: 'Kenney, Casino Audio', url: 'https://kenney.nl/assets/casino-audio' },
      { label: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    ],
  },
  {
    bodyKey: 'info.creditUiSfx',
    links: [
      { label: 'Kenney, Interface Sounds', url: 'https://kenney.nl/assets/interface-sounds' },
      { label: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    ],
  },
  { bodyKey: 'info.creditOriginal', links: [] },
];

function externalLink(label, url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  // Safari keeps links out of the tab sequence unless "Press Tab to highlight
  // each item" is on, so credit links state their place in it explicitly. Other
  // browsers treat this as a no-op. Matches the markup links in both pages.
  a.tabIndex = 0;
  a.textContent = label;
  return a;
}

function linkRow(links) {
  const row = document.createElement('p');
  row.className = 'info-links';
  for (const { label, url } of links) row.append(externalLink(label, url));
  return row;
}

/** @param {HTMLElement} container - the info page body, emptied and refilled */
export function renderInfoPage(container) {
  container.textContent = '';

  const section = (titleKey) => {
    const wrap = document.createElement('section');
    wrap.className = 'help-section';
    const h = document.createElement('h3');
    h.textContent = t(titleKey);
    wrap.append(h);
    container.append(wrap);
    return wrap;
  };

  const paragraph = (parent, text, className) => {
    const p = document.createElement('p');
    if (className) p.className = className;
    p.textContent = text;
    parent.append(p);
  };

  const about = section('info.aboutTitle');
  paragraph(about, t('info.aboutBody1'));
  paragraph(about, t('info.aboutBody2'));

  paragraph(section('info.fictionalTitle'), t('info.fictionalBody'));
  paragraph(section('info.noMoneyTitle'), t('info.noMoneyBody'));
  paragraph(section('info.purposeTitle'), t('info.purposeBody'));

  const privacy = section('info.privacyTitle');
  paragraph(privacy, t('info.privacyBody1'));
  paragraph(privacy, t('info.privacyBody2'));
  privacy.append(linkRow([{ label: t('info.privacyHostLink'), url: GITHUB_PAGES_PRIVACY_URL }]));

  const data = section('info.dataTitle');
  paragraph(data, t('info.dataBody1'));
  paragraph(data, t('info.dataBody2'));

  const multiplayer = section('info.mpTitle');
  paragraph(multiplayer, t('info.mpBody1'));
  paragraph(multiplayer, t('info.mpBody2'));
  paragraph(multiplayer, t('info.mpBody3'));
  paragraph(multiplayer, t('info.mpBody4'));

  const credits = section('info.creditsTitle');
  paragraph(credits, t('info.creditsIntro'));
  const creditList = document.createElement('ul');
  creditList.className = 'help-list';
  for (const credit of CREDITS) {
    const li = document.createElement('li');
    const body = document.createElement('p');
    body.textContent = t(credit.bodyKey);
    li.append(body);
    if (credit.noteKey) {
      const note = document.createElement('p');
      note.className = 'fine-print';
      note.textContent = t(credit.noteKey);
      li.append(note);
    }
    if (credit.links.length > 0) li.append(linkRow(credit.links));
    creditList.append(li);
  }
  credits.append(creditList);

  const source = section('info.sourceTitle');
  paragraph(source, t('info.sourceBody'));
  source.append(linkRow([{ label: REPO_LABEL, url: REPO_URL }]));

  const copyright = section('info.copyrightTitle');
  paragraph(copyright, t('info.copyrightBody1'));
  paragraph(copyright, t('info.copyrightBody2'));

  const responsible = section('info.responsibleTitle');
  paragraph(responsible, t('info.responsibleBody1'));
  paragraph(responsible, t('info.responsibleBody2'));

  const version = section('info.versionTitle');
  paragraph(version, `${t('info.versionApp')} : ${APP_VERSION}`);
  paragraph(version, t('info.versionBuildValue'), 'fine-print');
}
