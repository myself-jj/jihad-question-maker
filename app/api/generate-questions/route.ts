import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

interface IncomingImage {
  base64: string;
  mimeType: string;
}

const SYSTEM_PROMPT = `You are a senior exam-paper setter with 20 years of experience writing school-level multiple-choice tests.

You will receive photographs of textbook pages plus exam parameters. Follow these rules STRICTLY:

1. Read ALL the images carefully. Base every question ONLY on content actually present in the pages. Never invent facts that are not supported by the pages.
2. Mentally list every possible question, then DISCARD any that are: overly simple or trivial (e.g. "What is the title of this chapter?"), illogical, ambiguous, trick questions, dependent on a figure/page number the student cannot see, or have more than one defensible answer.
3. From the remainder, SELECT exactly the requested number of standard-level questions suitable for the stated class. Spread them evenly across the material; do not repeat or paraphrase the same idea twice. Mix recall, understanding and light application.
4. Each question must have exactly 4 plausible options with exactly ONE correct answer. Distractors must be believable, similar in length and style, and never "All of the above" / "None of the above".
5. Write in the SAME language as the textbook pages. If the pages are in Bangla, write every question and option in correct, natural Bangla (Bengali script) with proper spelling. Keep questions concise (ideally under 30 words) and options very short (ideally 1-6 words, never more than 12) so they fit a compact 2-column printed layout.
6. Do not number the questions and do not prefix options with A/B/C/D — the layout adds those.
7. Randomise the position of the correct answer across the set.
8. Output ONLY the JSON array that matches the schema. No commentary, no markdown fences.`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "সার্ভারে GEMINI_API_KEY সেট করা নেই। Netlify-তে Environment variables-এ যোগ করে আবার Deploy করুন।" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const images: IncomingImage[] = Array.isArray(body.images) ? body.images : [];
    const params = body.params ?? {};
    const target = Math.round(Number(params.numQuestions));

    if (images.length === 0) {
      return NextResponse.json({ error: "অনুগ্রহ করে বইয়ের অন্তত একটি পাতার ছবি দিন।" }, { status: 400 });
    }
    if (images.length > 10) {
      return NextResponse.json({ error: "একবারে সর্বোচ্চ ১০টি ছবি দেওয়া যাবে।" }, { status: 400 });
    }
    if (!Number.isFinite(target) || target < 1 || target > 100) {
      return NextResponse.json({ error: "প্রশ্নের সংখ্যা ১ থেকে ১০০ এর মধ্যে হতে হবে।" }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        // Gemini 3.x thinks for a long time by default; "low" keeps responses fast
        // enough for serverless time limits. (Cast: older SDK typings lack this field.)
        ...({ thinkingConfig: { thinkingLevel: "low" } } as any),
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              question: { type: SchemaType.STRING },
              options: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
              },
              correctIndex: { type: SchemaType.INTEGER },
            },
            required: ["question", "options", "correctIndex"],
          },
        },
      },
    });

    const part = body.part;
    const partNote =
      part && Number.isInteger(part.index) && Number.isInteger(part.total) && part.total > 1
        ? `\n\nIMPORTANT: This request covers only PART ${part.index + 1} of ${part.total}. Mentally divide the content of the attached page(s) from top to bottom into ${part.total} equal sections and write questions ONLY from section ${part.index + 1}.`
        : "";

    const instruction = `Exam: ${params.examName || "Exam"}
Class: ${params.className || "-"}
Subject: ${params.subject || "-"}
Total marks: ${params.totalMarks || "-"}
Total time: ${params.totalTime || "-"} minutes

Create EXACTLY ${target} multiple-choice questions from the attached textbook pages.
Return a JSON array of ${target} objects: { "question": string, "options": [4 strings], "correctIndex": 0-3 }.${partNote}`;

    const parts = [
      { text: instruction },
      ...images.map((img) => ({
        inlineData: { data: img.base64, mimeType: img.mimeType || "image/jpeg" },
      })),
    ];

    const run = async () => {
      const result = await model.generateContent(parts);
      const text = result.response.text();
      return JSON.parse(text.replace(/^```json\s*|```$/g, "").trim());
    };

    let raw: unknown;
    try {
      raw = await run();
    } catch {
      raw = await run(); // one retry for malformed JSON / transient errors
    }

    const list = Array.isArray(raw) ? raw : [];
    const questions = list
      .filter(
        (q: any) =>
          q &&
          typeof q.question === "string" &&
          Array.isArray(q.options) &&
          q.options.length >= 4 &&
          Number.isInteger(q.correctIndex) &&
          q.correctIndex >= 0 &&
          q.correctIndex <= 3
      )
      .map((q: any) => ({
        question: String(q.question).trim(),
        options: q.options.slice(0, 4).map((o: unknown) => String(o).trim()),
        correctIndex: q.correctIndex,
      }))
      .slice(0, target);

    if (questions.length === 0) {
      return NextResponse.json(
        { error: "এই ছবিগুলো থেকে AI সঠিক প্রশ্ন বানাতে পারেনি। আরও পরিষ্কার ছবি দিয়ে আবার চেষ্টা করুন।" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      questions,
      warning:
        questions.length < target
          ? `বইয়ের পাতা থেকে ${target}টির মধ্যে মাত্র ${questions.length}টি ভালো প্রশ্ন পাওয়া গেছে। আরও পাতা যোগ করে দেখতে পারেন।`
          : undefined,
    });
  } catch (err: any) {
    console.error("[generate-questions]", err);
    return NextResponse.json(
      { error: "প্রশ্ন তৈরি করতে গিয়ে সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন। (" + (err?.message || "অজানা ত্রুটি") + ")" },
      { status: 500 }
    );
  }
}
