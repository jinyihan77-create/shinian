import { DEFAULT_QUESTION, emptyCapture, type EchoNote } from "./types";

/** These are explicit fictional examples, never inserted on startup. */
export function createExamples(): EchoNote[] {
  const base: Omit<EchoNote, "id" | "title" | "userText"> = {
    ...emptyCapture(), tags: [], aiStatus: "not_started", aiResult: null,
    aiInputRevision: null, aiError: null, reflectionPrompt: DEFAULT_QUESTION,
    reflectionText: "", revision: 1, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), isExample: true,
  };
  return [
    {
      ...base, id: "eccc0001-0000-4000-8000-000000000001", title: "听完以后，试着说三句话",
      userText: "我发现自己听了很多播客，但如果不自己讲一遍，过两天就忘了。也许听完先写三句话，比收藏更多内容更有用。",
      sourceName: "演示来源（不是实际节目）", sourceUrl: "https://example.com/demo-podcast",
      tags: ["主动表达", "播客笔记"],
    },
    {
      ...base, id: "eccc0002-0000-4000-8000-000000000002", title: "把开始的门槛再放低一点",
      userText: "也许我需要把开始做事的门槛变得更低。", sourceType: "文章",
      sourceName: "演示片段（为示例编写，无真实出处）",
      sourceExcerpt: "【演示片段】如果一项行动难以开始，可以先缩小到今天愿意完成的一步。",
      tags: ["行动门槛", "小步开始"],
    },
    {
      ...base, id: "eccc0003-0000-4000-8000-000000000003", title: "给想法留一点呼吸的时间",
      userText: "离开屏幕走一走，似乎更容易把今天的想法连起来。", sourceType: "生活",
      sourceName: "演示生活记录", tags: ["散步", "整理思路"],
      reflectionText: "我想把周日散步留作不听新内容的时间，用自己的话复述本周最有感触的三个想法。先想清楚，再决定哪些值得继续写。",
    },
  ];
}
