
import { readFile, writeFile } from "node:fs/promises";

const research = JSON.parse(
  await readFile("output/research.json", "utf8")
);

const sources = [
  research.primaryResearch,
  ...(research.additionalResearch ?? [])
]
.filter(p => p?.abstract && p?.sourceUrl)
.slice(0, 5)
.map((p, i) => ({
  number: i + 1,
  title: p.title,
  year: p.year,
  url: p.sourceUrl,
  abstract: p.abstract.slice(0, 1800)
}));

if (sources.length === 0) {
  throw new Error("No research sources available");
}

// 無料のローカルAIを呼び出す
async function askAI(model, prompt) {
  const response = await fetch(
    "http://127.0.0.1:11434/api/generate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        options: {
          temperature: 0.2,
          num_ctx: 8192,
          num_predict: 2500
        }
      }),
      signal: AbortSignal.timeout(300000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `${model} API error: ${response.status}`
    );
  }

  const data = await response.json();
  return JSON.parse(data.response);
}

const sourceText = JSON.stringify(sources);

// AI① 日本語のスライド原稿を作る
const scriptPrompt = `
あなたは科学的根拠を重視する心理学ライターです。

次の研究要旨だけを根拠にして、
Instagram、TikTok、YouTube Shorts向けの
日本語スライド原稿を作成してください。

条件:
- スライドは必ず10枚
- 1枚目は興味を引くタイトル
- 2～9枚目で研究内容を説明
- 10枚目は結論と研究の限界
- 各スライドはtitle、body、sourceIndexを持つ
- sourceIndexは根拠となる研究のnumber
- bodyは日本語で原則30～75文字
- 因果関係が不明な場合は断定しない
- 実験結果や数値を創作しない
- 研究の対象者を一般化しない
- 不明な内容は書かない
- 医学的診断や治療を勧めない
- 研究情報が足りなければ推測で補わない

JSONのみ返してください。

形式:
{
  "slides": [
    {
      "title": "タイトル",
      "body": "説明文",
      "sourceIndex": 1
    }
  ],
  "caption": "投稿用説明文"
}

研究情報:
${sourceText}
`;

console.log("Qwen: Creating Japanese content...");

let draft;

for (let attempt = 0; attempt < 2; attempt++) {
  draft = await askAI("qwen2.5:1.5b", scriptPrompt);

  if (
    Array.isArray(draft.slides) &&
    draft.slides.length === 10 &&
    draft.slides.every(s =>
      typeof s.title === "string" &&
      typeof s.body === "string" &&
      Number.isInteger(s.sourceIndex) &&
      s.sourceIndex >= 1 &&
      s.sourceIndex <= sources.length
    )
  ) {
    break;
  }

  draft = null;
}

if (!draft) {
  throw new Error("AI failed to create 10 valid slides");
}

// AI② 内容を研究と比較する
const reviewPrompt = `
あなたは科学的な内容を検証する編集者です。

以下の原稿を研究要旨と比較してください。

確認項目:
1. 研究で裏付けられない主張がないか
2. 相関を因果関係と誤解していないか
3. 数字や研究結果を創作していないか
4. 対象者や研究の限界を無視していないか
5. sourceIndexの研究が主張を支えているか

慎重に判定してください。

次のJSON形式のみ返してください。

{
  "approved": false,
  "issues": ["指摘事項"]
}

すべて根拠で支持されると判断した場合のみ
approvedをtrueにしてください。

研究:
${sourceText}

原稿:
${JSON.stringify(draft)}
`;

console.log("Gemma: Reviewing evidence...");

const review = await askAI(
  "gemma3:1b",
  reviewPrompt
);

const result = {
  generatedAt: new Date().toISOString(),
  topic: research.candidateTopic,
  models: [
    "qwen2.5:1.5b",
    "gemma3:1b"
  ],
  slides: draft.slides.map(s => ({
    title: s.title,
    body: s.body,
    sourceUrl: sources[s.sourceIndex - 1].url
  })),
  caption: draft.caption ?? "",
  review: {
    approvedByAI: review.approved === true,
    issues: Array.isArray(review.issues)
      ? review.issues
      : ["Review response was incomplete"]
  },
  publicationStatus: "HUMAN_REVIEW_REQUIRED",
  sources
};

await writeFile(
  "output/ai_draft.json",
  JSON.stringify(result, null, 2),
  "utf8"
);

console.log("AI draft and review saved");
console.log("output/ai_draft.json");
