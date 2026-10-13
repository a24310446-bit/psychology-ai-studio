
import { readFile, writeFile } from "node:fs/promises";

const research = JSON.parse(
  await readFile("output/research.json", "utf8")
);

const paper = research.primaryResearch;

if (!paper?.abstract || !paper?.sourceUrl || !paper?.title) {
  throw new Error("研究データが足りません");
}

const evidence = JSON.stringify({
  title: paper.title,
  year: paper.year,
  abstract: paper.abstract.slice(0, 3500),
  sourceUrl: paper.sourceUrl
});

// AIを呼び出す
async function askAI(model, prompt, schema, maxTokens = 2200) {
  const response = await fetch(
    "http://127.0.0.1:11434/api/generate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        format: schema,
        stream: false,
        options: {
          temperature: 0,
          num_ctx: 8192,
          num_predict: maxTokens
        }
      }),
      signal: AbortSignal.timeout(300000)
    }
  );

  if (!response.ok) {
    throw new Error(`${model}: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.response) {
    throw new Error(`${model}: 空の応答`);
  }

  return JSON.parse(data.response);
}

// 5枚のスライドを指定する形式
const slideSchema = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" }
        },
        required: ["title", "body"],
        additionalProperties: false
      }
    }
  },
  required: ["slides"],
  additionalProperties: false
};

// 5枚ずつ生成する
async function generateFive(start) {
  const end = start + 4;

  const tasks = start === 1
    ? "1:導入 2:研究の問い 3:研究対象や方法（不明なら不明と明記） 4:主要な結果 5:結果の意味"
    : "6:補足説明 7:解釈上の注意 8:因果関係への注意 9:読者向けまとめ 10:結論と研究の限界";

  const prompt = `
あなたは慎重な科学記事の編集者です。

以下の論文要旨だけに基づき、
日本語のスライド${start}〜${end}を
5枚作成してください。

各枚にtitleとbodyを含めてください。
bodyは日本語30〜70文字程度。

禁止事項:
- 推測
- 架空の数値
- 根拠のない断定
- 研究対象の不適切な一般化

論文にない内容は
「要旨だけでは不明」と書いてください。

並び順:
${tasks}

必ず5枚のJSONオブジェクトを返してください。

根拠:
${evidence}
`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await askAI(
        "qwen2.5:1.5b",
        prompt,
        slideSchema
      );

      const slides = result.slides;

      if (
        Array.isArray(slides) &&
        slides.length === 5 &&
        slides.every(s =>
          typeof s.title === "string" &&
          s.title.trim() &&
          typeof s.body === "string" &&
          s.body.trim()
        )
      ) {
        return slides.map(s => ({
          title: s.title.trim(),
          body: s.body.trim(),
          sourceUrl: paper.sourceUrl
        }));
      }

      console.log(
        `スライド${start}〜${end}: 形式不正 試行${attempt}`
      );

    } catch (error) {
      console.log(
        `スライド${start}〜${end}: ${error.message}`
      );
    }
  }

  throw new Error(
    `スライド${start}〜${end}の生成に失敗`
  );
}

// Qwenで10枚生成
console.log("Qwen: 前半5枚を作成");

const first = await generateFive(1);

console.log("Qwen: 後半5枚を作成");

const second = await generateFive(6);

const slides = [...first, ...second];

// Gemmaによる検証
const reviewSchema = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    issues: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["approved", "issues"],
  additionalProperties: false
};

let review;

try {
  review = await askAI(
    "gemma3:1b",
    `
論文の要旨を根拠として、
以下の日本語スライドを検証してください。

確認事項:
- 誇張がないか
- 根拠のない因果説明がないか
- 架空の数字がないか
- 不適切な一般化がないか

JSONでapprovedとissuesを返してください。

論文:
${evidence}

スライド:
${JSON.stringify(slides)}
`,
    reviewSchema,
    1000
  );

  if (
    typeof review.approved !== "boolean" ||
    !Array.isArray(review.issues)
  ) {
    throw new Error("検証結果が不正");
  }

} catch (error) {
  review = {
    approved: false,
    issues: [
      `AIによる確認が完了していません: ${error.message}`
    ]
  };
}

// 完成した原稿を保存
await writeFile(
  "output/ai_draft.json",
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    topic: paper.title,
    models: [
      "qwen2.5:1.5b",
      "gemma3:1b"
    ],
    slides,
    caption:
      `研究紹介: ${paper.title}\n出典: ${paper.sourceUrl}`,
    review: {
      approvedByAI: review.approved,
      issues: review.issues
    },
    publicationStatus: "HUMAN_REVIEW_REQUIRED",
    sources: [paper]
  }, null, 2)
);

console.log("完成: 10枚の日本語原稿");
console.log("output/ai_draft.json");
