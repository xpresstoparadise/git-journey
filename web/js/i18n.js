// Interface language: English and Russian. ?lang=en|ru → remembered choice →
// browser language. Safe to import in node (tests): falls back to Russian there.

const DICT = {
  en: {
    // kinds & events
    "kind.created": "Birth", "kind.commit": "Commit", "kind.mr": "Merge request",
    "kind.commitInMr": "Commit in !{iid}",
    "event.created": "The repository was born", "event.commit": "commit",
    "node.created": "repository created", "node.merged": "merged into main",
    // focus card
    "card.expand": "Expand the card",
    "card.inFocus": "In focus", "state.alive": "alive", "state.done": "finished",
    "fact.owner": "Owner", "fact.created": "Created", "fact.branch": "Branch",
    "fact.date": "Date", "fact.author": "Author", "fact.status": "Status", "fact.files": "Files",
    "fact.road": "Road", "fact.commitsMrs": "Commits · MRs",
    "status.merged": "merged into {branch}",
    "stat.mrs": "MRs to main", "stat.lines": "lines", "stat.added": "added", "stat.deleted": "deleted",
    "card.feed": "Feed · {period}",
    "card.openGitlab": "Open in GitLab ↗", "card.spaceHint": "Space — continue the film",
    // finale
    "finale.kicker": "Finish · {period}", "finale.title": "The team's contribution",
    "finale.repos": "repos · {alive} alive", "finale.finished": " · {n} finished",
    "finale.linesPeriod": "lines over the period",
    "finale.ranking": "Ranking · commit {c} · MR {m} · new repo {n}",
    "finale.row": "{c} commits · {m} MRs · {r} repos", "finale.rowNew": " · {n} new",
    "person.kicker": "One person's road · {period}", "person.rank": "#{rank} of {total}",
    "person.linesAdded": "lines added", "person.linesDeleted": "lines deleted",
    "person.repos": "repos", "person.share": "{s}% of all lines the team changed",
    "person.where": "Worked in", "person.team": "Team · ranking",
    "finish.kicker": "Project finished", "finish.crew": "Project crew · {n}",
    "farewell.hello": "Good bye,", "farewell.thanks": "Thank you for the road",
    "farewell.skip": "click or Enter — continue",
    // captions (cinema)
    "cap.newRoad": "New road · {name}", "cap.again": "Again · {name}",
    "cap.week": "{n} {changes} · week of {day}", "cap.alive": " · alive",
    "cap.branch": "Branch !{iid} · {name}", "cap.merged": "Merged !{iid} · {name}",
    "cap.repoDone": "Finished · {name}", "cap.repoDoneLine": "The branch flows back into the history",
    "cap.congrats": "Congratulations!", "cap.congratsSub": "{name} · the road is complete",
    "cap.projectDone": "Project finished · {name}", "cap.crewThanks": "{n} {people} · thank you all",
    "cap.goodbye": "Good bye, {name}", "cap.goodbyeLine": "thank you for the road",
    "cap.personRoad": "{name}'s road", "cap.personLine": "{c} commits · {m} MRs · +{a} −{d} lines",
    "cap.team": "The team's contribution",
    "cap.teamLine": "{p} repos · {alive} alive · {n} {authors} · click an author — their road",
    "cap.start": "The period begins", "cap.startLine": "{period} · {p} repos · {mode}",
    "cap.modeFull": "full film", "cap.modeHighlights": "highlights",
    "cap.personStart": "{period} · one person's road",
    "cap.seek": "Rewind", "cap.seekLine": "from the week of {day}",
    "cap.trunk": "The GitLab trunk", "cap.trunkLine": "{day} · {n} repos at work",
    "cap.toNow": "Up to now", "cap.toNowLine": "Living repos run alongside the trunk",
    "cap.now": "Now", "cap.nowSub": "{n} living branches",
    "cap.walked": "The road is walked", "cap.walkedLine": "…and the star goes out",
    "cap.silence": "Silence", "cap.silenceLine": "No changes in this period",
    "cap.clickAuthor": "click an author — their road",
    "cap.authorRoad": "{name}'s road", "cap.authorRoadLine": "{n} {changes} in {r} repos",
    "cap.recSaved": "Recording saved", "cap.recMp4": "MP4 — Telegram plays it right away",
    "cap.recWebm": "WebM — for Telegram better use Chrome/Edge 126+ (MP4)",
    "cap.recCancelled": "Recording cancelled", "cap.recDenied": "the browser didn't allow capturing the tab",
    "chapter.title": "Git Life Way", "chapter.sub": "{period} · {p} repos",
    // top bar & controls
    "source.repos": "{n} repos", "source.fetched": "exported {date}",
    "source.demoParam": "demo team · ?demo", "source.demo": "demo data · run fetch_local.py or fetch_gitlab.py",
    "person.all": "all people", "btn.pause": "Pause", "btn.continue": "Continue",
    "period.all": "All time", "now": "now", "aria.world": "The team's git life way",
    "rec.screen": "Screen 16:9", "rec.screenHint": "the whole film, as on screen",
    "rec.telegram": "Telegram 9:16", "rec.telegramHint": "vertical, highlights 1.5×",
    "rec.square": "Square 1:1", "rec.squareHint": "post or chat, highlights 1.5×",
    // static page
    "ui.period": "Period", "ui.person": "Person", "ui.personAria": "Whose road to show",
    "ui.modeAria": "Cut of the film", "ui.highlights": "Highlights", "ui.full": "Full",
    "ui.highlightsTitle": "Key moments only, ~1.5 minutes (M)", "ui.fullTitle": "Every visit to every repo (M)",
    "ui.speed": "Speed", "ui.speed1": "Speed 1× (key 1)", "ui.speed2": "Speed 2× (key 2)", "ui.speed4": "Speed 4× (key 3)",
    "ui.pauseTitle": "Pause / continue (Space)", "ui.skip": "To the finale", "ui.skipTitle": "Straight to the summary (F)",
    "ui.cinema": "Cinema", "ui.cinemaTitle": "Presentation: fullscreen and letterbox (P)",
    "ui.record": "Record", "ui.recordTitle": "Record the film: 16:9, Telegram 9:16, square",
    "ui.replay": "Replay", "ui.replayTitle": "Play again (R)",
    "ui.legend": "Legend", "lg.trunk": "GitLab trunk", "lg.born": "birth", "lg.commit": "commit (repo colour)",
    "ui.fresh": "A fresh export is available", "ui.reload": "Reload",
    "ui.kbd": "Space — pause · click the timeline — seek · M — highlights/full · P — cinema · F — finale · R — replay",
  },
  ru: {
    "kind.created": "Рождение", "kind.commit": "Коммит", "kind.mr": "Merge request",
    "kind.commitInMr": "Коммит в !{iid}",
    "event.created": "Репозиторий появился", "event.commit": "коммит",
    "node.created": "репозиторий создан", "node.merged": "влит в main",
    "card.expand": "Развернуть карточку",
    "card.inFocus": "В фокусе", "state.alive": "живой", "state.done": "завершён",
    "fact.owner": "Владелец", "fact.created": "Создан", "fact.branch": "Ветка",
    "fact.date": "Дата", "fact.author": "Автор", "fact.status": "Статус", "fact.files": "Файлов",
    "fact.road": "Путь", "fact.commitsMrs": "Коммитов · MR",
    "status.merged": "влит в {branch}",
    "stat.mrs": "MR в main", "stat.lines": "строк", "stat.added": "добавлено", "stat.deleted": "удалено",
    "card.feed": "Лента · {period}",
    "card.openGitlab": "Открыть в GitLab ↗", "card.spaceHint": "Пробел — продолжить показ",
    "finale.kicker": "Финиш · {period}", "finale.title": "Вклад команды",
    "finale.repos": "репо · {alive} живых", "finale.finished": " · {n} заверш.",
    "finale.linesPeriod": "строк за период",
    "finale.ranking": "Рейтинг · коммит {c} · MR {m} · новый репо {n}",
    "finale.row": "{c} комм · {m} MR · {r} репо", "finale.rowNew": " · {n} нов.",
    "person.kicker": "Путь участника · {period}", "person.rank": "{rank} место из {total}",
    "person.linesAdded": "строк добавлено", "person.linesDeleted": "строк удалено",
    "person.repos": "репо", "person.share": "{s}% всех изменённых строк команды",
    "person.where": "Где работал", "person.team": "Команда · рейтинг",
    "finish.kicker": "Проект завершён", "finish.crew": "Команда проекта · {n}",
    "farewell.hello": "Good bye,", "farewell.thanks": "Спасибо за путь",
    "farewell.skip": "клик или Enter — дальше",
    "cap.newRoad": "Новый путь · {name}", "cap.again": "Снова · {name}",
    "cap.week": "{n} {changes} · неделя {day}", "cap.alive": " · живой",
    "cap.branch": "Ветка !{iid} · {name}", "cap.merged": "Влит !{iid} · {name}",
    "cap.repoDone": "Завершён · {name}", "cap.repoDoneLine": "Ветка вливается обратно в историю GitLab",
    "cap.congrats": "Поздравляем!", "cap.congratsSub": "{name} · путь завершён",
    "cap.projectDone": "Проект завершён · {name}", "cap.crewThanks": "{n} {people} · спасибо всем",
    "cap.goodbye": "Good bye, {name}", "cap.goodbyeLine": "спасибо за путь",
    "cap.personRoad": "Путь · {name}", "cap.personLine": "{c} комм · {m} MR · +{a} −{d} строк",
    "cap.team": "Вклад команды",
    "cap.teamLine": "{p} репо · {alive} живых · {n} {authors} · клик по автору — его путь",
    "cap.start": "Старт периода", "cap.startLine": "{period} · {p} репо · {mode}",
    "cap.modeFull": "полная версия", "cap.modeHighlights": "главное",
    "cap.personStart": "путь участника · {period}",
    "cap.seek": "Перемотка", "cap.seekLine": "с недели {day}",
    "cap.trunk": "Ствол GitLab", "cap.trunkLine": "{day} · {n} репо в работе",
    "cap.toNow": "До настоящего", "cap.toNowLine": "Живые репо бегут параллельно стволу",
    "cap.now": "Настоящее", "cap.nowSub": "{n} живых веток",
    "cap.walked": "Путь пройден", "cap.walkedLine": "…и звезда гаснет",
    "cap.silence": "Тишина", "cap.silenceLine": "В выбранном периоде нет изменений",
    "cap.clickAuthor": "клик по автору — его путь",
    "cap.authorRoad": "Путь · {name}", "cap.authorRoadLine": "{n} {changes} в {r} репо",
    "cap.recSaved": "Запись сохранена", "cap.recMp4": "MP4 — Telegram покажет сразу",
    "cap.recWebm": "WebM — для Telegram лучше Chrome/Edge 126+ (MP4)",
    "cap.recCancelled": "Запись отменена", "cap.recDenied": "браузер не дал доступ к вкладке",
    "chapter.title": "Git Life Way", "chapter.sub": "{period} · {p} репо",
    "source.repos": "{n} репо", "source.fetched": "выгрузка {date}",
    "source.demoParam": "демо-команда · ?demo", "source.demo": "демо-данные · запустите fetch_local.py или fetch_gitlab.py",
    "person.all": "все участники", "btn.pause": "Пауза", "btn.continue": "Дальше",
    "period.all": "Весь срок", "now": "настоящее", "aria.world": "Git life way команды",
    "rec.screen": "Экран 16:9", "rec.screenHint": "весь показ, как на экране",
    "rec.telegram": "Telegram 9:16", "rec.telegramHint": "вертикально, «Главное» 1.5×",
    "rec.square": "Квадрат 1:1", "rec.squareHint": "пост или чат, «Главное» 1.5×",
    "ui.period": "Период", "ui.person": "Участник", "ui.personAria": "Чей путь показать",
    "ui.modeAria": "Версия показа", "ui.highlights": "Главное", "ui.full": "Полностью",
    "ui.highlightsTitle": "Только ключевые моменты, ~1.5 минуты (M)", "ui.fullTitle": "Каждый визит в каждый репо (M)",
    "ui.speed": "Скорость", "ui.speed1": "Скорость 1× (клавиша 1)", "ui.speed2": "Скорость 2× (клавиша 2)", "ui.speed4": "Скорость 4× (клавиша 3)",
    "ui.pauseTitle": "Пауза / дальше (пробел)", "ui.skip": "К финалу", "ui.skipTitle": "Сразу к сводке (F)",
    "ui.cinema": "Кино", "ui.cinemaTitle": "Презентация: полный экран и кинорамка (P)",
    "ui.record": "Запись", "ui.recordTitle": "Записать показ в видео: 16:9, Telegram 9:16, квадрат",
    "ui.replay": "Сначала", "ui.replayTitle": "Проиграть снова (R)",
    "ui.legend": "Обозначения", "lg.trunk": "ствол GitLab", "lg.born": "рождение", "lg.commit": "коммит (цвет репо)",
    "ui.fresh": "Есть свежая выгрузка из GitLab", "ui.reload": "Обновить",
    "ui.kbd": "Пробел — пауза · клик по шкале — перемотка · M — главное/всё · P — кино · F — финал · R — сначала",
  },
};

// Plural word forms: en [one, other], ru [one, few, many].
const WORDS = {
  en: {
    commit: ["commit", "commits"], change: ["change", "changes"], author: ["author", "authors"],
    person: ["person", "people"], file: ["file", "files"],
  },
  ru: {
    commit: ["коммит", "коммита", "коммитов"], change: ["изменение", "изменения", "изменений"],
    author: ["автор", "автора", "авторов"], person: ["участник", "участника", "участников"],
    file: ["файл", "файла", "файлов"],
  },
};

function detect() {
  if (typeof window === "undefined") return "ru";
  try {
    const q = new URL(window.location.href).searchParams.get("lang");
    if (q === "en" || q === "ru") { localStorage.setItem("lifeway.lang", q); return q; }
    const saved = localStorage.getItem("lifeway.lang");
    if (saved === "en" || saved === "ru") return saved;
  } catch { /* storage blocked — fall through */ }
  const configured = window.LIFEWAY_CONFIG?.language; // lifeway.json, if not "auto"
  if (configured === "en" || configured === "ru") return configured;
  const nav = (navigator.languages?.[0] || navigator.language || "en").toLowerCase();
  const fallback = document.documentElement.dataset.defaultLang;
  return nav.startsWith("ru") ? "ru" : fallback === "ru" ? "ru" : "en";
}

export const LANG = detect();
export const LOCALE = LANG === "ru" ? "ru-RU" : "en-GB";

/** t("cap.week", {n: 3, day: "2 Feb"}) — missing keys fall back to Russian, then the key. */
export function t(key, vars = {}) {
  const s = DICT[LANG][key] ?? DICT.ru[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

/** Word for a count: w(5, "commit") → "commits" / «коммитов». */
export function w(n, word) {
  const forms = WORDS[LANG][word];
  if (!forms) return word;
  if (LANG === "en") return Math.abs(n) === 1 ? forms[0] : forms[1];
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

/** Static HTML: elements with data-i18n="key" / data-i18n-title / data-i18n-aria. */
export function translateDom(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  document.documentElement.lang = LANG;
}

export function setLang(lang) {
  try { localStorage.setItem("lifeway.lang", lang); } catch { /* ignore */ }
  const url = new URL(window.location.href);
  url.searchParams.set("lang", lang);
  window.location.href = url.toString();
}
