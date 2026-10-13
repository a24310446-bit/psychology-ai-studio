
import { mkdir, readFile, writeFile } from "node:fs/promises";

// 心理学の幅広い検索分野
const searchAreas = [
  "social comparison",
  "procrastination",
  "habit formation",
  "decision making",
  "risk perception",
  "social conformity",
  "peer influence",
  "social norms",
  "moral judgment",
  "empathy",
  "helping behavior",
  "self control",
  "reward learning",
  "human motivation",
  "curiosity",
  "cognitive bias",
  "confirmation bias",
  "attention bias",
  "music emotion",
  "music preference",
  "music memory",
  "emotional contagion",
  "nonverbal communication",
  "eye contact",
  "loneliness",
  "social belonging",
  "interpersonal trust",
  "group identity",
  "persuasion psychology",
  "behavioral economics",
  "self efficacy",
  "stress coping",
  "gratitude",
  "mind wandering",
  "goal setting",
  "interpersonal attraction",
  "friendship psychology",
  "social rejection",
  "resilience",
  "positive reinforcement",
  "impulse control",
  "consumer choice",
  "language emotion",
  "rhythm movement",
  "interpersonal conflict",
  "reciprocity",
  "altruism",
  "false memory",
  "time perception",
  "emotion regulation",
  "fear learning",
  "anticipation psychology",
  "sleep emotion",
  "social media behavior",
  "cooperation psychology",
  "social identity",
  "memory formation",
  "habit change",
  "social influence",
  "reward anticipation"
];

const historyPath = "history/used_topics.json";
const outputPath = "output/research.json";

// 過去の使用履歴を読み込む
let history = [];

try {
  history = JSON.parse(
    await readFile(historyPath, "utf8")
  );

  if (!Array.isArray(history)) {
    throw new Error("Invalid history");
  }
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

// ランダムに並べ替える
function shuffle(list) {
  const result = [...list];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [
      result[j],
      result[i]
    ];
  }

  return result;
}

// タイトル比較に不要な単語
const stopWords = new Set([
  "study",
  "studies",
  "among",
  "between",
  "effects",
  "effect",
  "using",
  "analysis",
  "review",
  "systematic",
  "research",
  "association",
  "associations",
  "relationship",
  "relationships",
  "role",
  "individuals",
  "people",
  "human",
  "humans",
  "evidence",
  "impact",
  "influence",
  "influences",
  "psychological",
  "behavioral",
  "behavioural",
  "experimental",
  "longitudinal",
  "predictors",
  "exploring",
  "understanding"
]);

function terms(title) {
  return new Set(
    (
      title.toLowerCase().match(/[a-z]{4,}/g) ?? []
    ).filter(word => !stopWords.has(word))
  );
}

// 似ている研究タイトルを検出
function tooSimilar(titleA, titleB) {
  if (
    titleA.trim().toLowerCase() ===
    titleB.trim().toLowerCase()
  ) {
    return true;
  }

  const a = terms(titleA);
  const b = terms(titleB);

  if (!a.size || !b.size) {
    return false;
  }

  const overlap = [...a].filter(
    term => b.has(term)
  ).length;

  return (
    overlap >= 2 &&
    overlap / Math.min(a.size, b.size) >= 0.6
  );
}

// Europe PMCから研究を検索
async function search(area) {
  const url = new URL(
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
  );

  url.searchParams.set(
    "query",
    `(${area}) AND (psychology OR behavior) AND SRC:MED`
  );

  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", "100");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(
      `Europe PMC error: ${response.status}`
    );
  }

  const json = await response.json();

  return shuffle(
    json.resultList?.result ?? []
  ).filter(p =>
    p.source === "MED" &&
    p.id &&
    p.title &&
    p.abstractText &&
    p.abstractText.length >= 200 &&
    Number(p.pubYear) >= 2005 &&
    p.isRetracted !== "Y" &&
    !/retracted publication/i.test(p.title)
  );
}

// 未使用の研究を選択
let selected;
let related = [];
let areaUsed;

for (const area of shuffle(searchAreas)) {
  let papers;

  try {
    papers = await search(area);
  } catch (error) {
    console.warn(
      `Search failed: ${area}: ${error.message}`
    );
    continue;
  }

  const eligible = papers.filter(p =>
    !history.some(old =>
      old.paperId === `${p.source}/${p.id}` ||
      (
        p.doi &&
        old.doi?.toLowerCase() ===
        p.doi.toLowerCase()
      ) ||
      tooSimilar(p.title, old.title)
    )
  );

  if (eligible.length === 0) {
    continue;
  }

  selected = eligible[0];

  related = papers
    .filter(p => p.id !== selected.id)
    .slice(0, 4);

  areaUsed = area;
  break;
}

// 新しい研究がなければ停止
if (!selected) {
  throw new Error(
    "No new research found. Nothing reused."
  );
}

// 研究データを整理
function formatPaper(p) {
  return {
    paperId: `${p.source}/${p.id}`,
    title: p.title
      .replace(/<[^>]*>/g, " ")
      .trim(),
    year: p.pubYear,
    journal: p.journalTitle ?? "",
    doi: p.doi ?? null,
    abstract: p.abstractText
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    sourceUrl:
      `https://europepmc.org/article/${p.source}/${p.id}`
  };
}

const primary = formatPaper(selected);

// 使用履歴用データ
const record = {
  paperId: primary.paperId,
  title: primary.title,
  doi: primary.doi,
  area: areaUsed,
  generatedAt: new Date().toISOString()
};

// 保存フォルダ作成
await mkdir("output", {
  recursive: true
});

await mkdir("history", {
  recursive: true
});

// 研究情報を保存
await writeFile(
  outputPath,
  JSON.stringify({
    area: areaUsed,
    candidateTopic: primary.title,
    primaryResearch: primary,
    additionalResearch:
      related.map(formatPaper),
    factCheckStatus:
      "Not yet checked by multiple AI models",
    note:
      "Verify evidence, methods and limitations before posting."
  }, null, 2)
);

// 使用履歴を保存
await writeFile(
  historyPath,
  JSON.stringify(
    [...history, record],
    null,
    2
  ) + "\n"
);

console.log(
  `New research: ${primary.title}`
);

console.log(
  `Source: ${primary.sourceUrl}`
);

console.log(
  `Previous topics: ${history.length}`
);

console.log(
  "Saved research and history"
);
