"use client";

import * as React from "react";
import {
  FileText,
  Loader2,
  Sparkles,
  Clock,
  Award,
  Hash,
  GraduationCap,
  BookOpen,
  PenLine,
  Download,
  Trash2,
  History as HistoryIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UploadZone } from "@/components/upload-zone";
import { generateQuestionPaperPdf } from "@/lib/pdf";
import { toBn } from "@/lib/utils";
import { addHistory, formatDate, loadHistory, removeHistory, type HistoryItem } from "@/lib/history";
import type { ExamParams, MCQ, UploadedImage } from "@/lib/types";

const initial: ExamParams = {
  examName: "",
  className: "",
  subject: "",
  totalTime: "",
  totalMarks: "",
  numQuestions: 20,
};

function Field({
  id,
  label,
  icon: Icon,
  children,
  className,
}: {
  id: string;
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </Label>
      {children}
    </div>
  );
}

async function fetchQuestions(
  imgs: UploadedImage[],
  params: ExamParams,
  part?: { index: number; total: number }
): Promise<MCQ[]> {
  const res = await fetch("/api/generate-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      params,
      part,
      images: imgs.map(({ base64, mimeType }) => ({ base64, mimeType })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 413) throw new Error("ছবির সাইজ অনেক বেশি। কম ছবি দিয়ে আবার চেষ্টা করুন।");
    if (res.status === 504) throw new Error("সময় শেষ হয়ে গেছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।");
    throw new Error(data.error || `অনুরোধ ব্যর্থ হয়েছে (${toBn(res.status)})`);
  }
  return data.questions as MCQ[];
}

export default function Home() {
  const [images, setImages] = React.useState<UploadedImage[]>([]);
  const [form, setForm] = React.useState<ExamParams>(initial);
  const [loading, setLoading] = React.useState(false);
  const [step, setStep] = React.useState("");
  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setHistory(loadHistory());
  }, []);

  async function redownload(item: HistoryItem) {
    setDownloadingId(item.id);
    try {
      await generateQuestionPaperPdf(item.exam, item.questions);
      toast.success("PDF নামানো হয়েছে।");
    } catch {
      toast.error("PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setDownloadingId(null);
    }
  }

  function removeItem(id: string) {
    setHistory(removeHistory(id));
    toast.success("মুছে ফেলা হয়েছে।");
  }

  const set = (k: keyof ExamParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === "numQuestions" ? Number(e.target.value) : e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (images.length === 0) return toast.error("প্রথমে বইয়ের অন্তত একটি পাতার ছবি দিন।");
    if (!form.numQuestions || form.numQuestions < 1) return toast.error("প্রশ্নের সংখ্যা সঠিকভাবে লিখুন।");

    setLoading(true);
    setStep("ছবি বিশ্লেষণ করা হচ্ছে…");
    const toastId = toast.loading("AI আপনার বইয়ের পাতা পড়ে প্রশ্ন বানাচ্ছে…");

    try {
      // ছবিগুলো ৩টি করে ভাগ করে একসাথে (parallel) পাঠানো হয়, যাতে প্রতিটি অনুরোধ অল্প সময়ে শেষ হয়।
      // কাজ ভাগ: প্রতিটি অনুরোধে সর্বোচ্চ ~২টি ছবি ও ~৮টি প্রশ্ন (সর্বোচ্চ ৮টি অনুরোধ)।
      const total = form.numQuestions;
      const nImg = images.length;
      const jobsCount = Math.min(8, Math.max(Math.ceil(nImg / 2), Math.ceil(total / 8), 1));
      const jobs: { imgs: UploadedImage[]; part?: { index: number; total: number } }[] = [];
      if (jobsCount <= nImg) {
        // ছবিগুলো পরপর কয়েকটি দলে ভাগ
        for (let j = 0; j < jobsCount; j++) {
          const from = Math.floor((j * nImg) / jobsCount);
          const to = Math.floor(((j + 1) * nImg) / jobsCount);
          jobs.push({ imgs: images.slice(from, to) });
        }
      } else {
        // ছবি কম, কাজ বেশি: একটি ছবির আলাদা আলাদা অংশ থেকে আলাদা অনুরোধ
        const owner = Array.from({ length: jobsCount }, (_, j) => Math.floor((j * nImg) / jobsCount));
        const shared: Record<number, number> = {};
        owner.forEach((o) => (shared[o] = (shared[o] || 0) + 1));
        const usedCount: Record<number, number> = {};
        for (let j = 0; j < jobsCount; j++) {
          const o = owner[j];
          const k = (usedCount[o] = (usedCount[o] ?? -1) + 1);
          jobs.push({
            imgs: [images[o]],
            part: shared[o] > 1 ? { index: k, total: shared[o] } : undefined,
          });
        }
      }
      const base = Math.floor(total / jobs.length);
      const extra = total % jobs.length;

      const settled = await Promise.allSettled(
        jobs.map((job, i) => {
          const n = base + (i < extra ? 1 : 0);
          return n > 0
            ? fetchQuestions(job.imgs, { ...form, numQuestions: n }, job.part)
            : Promise.resolve([] as MCQ[]);
        })
      );
      const failed = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");

      const seen = new Set<string>();
      const questions: MCQ[] = [];
      for (const s of settled) {
        if (s.status !== "fulfilled") continue;
        for (const q of s.value) {
          const key = q.question.replace(/\s+/g, " ").trim();
          if (!seen.has(key)) {
            seen.add(key);
            questions.push(q);
          }
        }
      }
      if (questions.length === 0) {
        throw failed[0]?.reason ?? new Error("কোনো প্রশ্ন তৈরি হয়নি। আবার চেষ্টা করুন।");
      }
      questions.splice(total);
      setHistory(addHistory(form, [...questions]));

      setStep("PDF তৈরি হচ্ছে…");
      toast.loading("প্রশ্নপত্রের PDF তৈরি হচ্ছে…", { id: toastId });
      await generateQuestionPaperPdf(form, questions);

      toast.success(`প্রশ্নপত্র তৈরি! মোট ${toBn(questions.length)}টি প্রশ্ন।`, { id: toastId });
      if (failed.length > 0) {
        toast.warning("কিছু ছবির অংশ প্রক্রিয়া করা যায়নি, তাই প্রশ্ন কম এসেছে। চাইলে আবার চেষ্টা করুন।");
      } else if (questions.length < total) {
        toast.warning(`${toBn(total)}টির মধ্যে ${toBn(questions.length)}টি ভালো প্রশ্ন পাওয়া গেছে। আরও পাতা যোগ করে দেখতে পারেন।`);
      }
    } catch (err: any) {
      toast.error(err.message || "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।", { id: toastId });
    } finally {
      setLoading(false);
      setStep("");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10 sm:py-16">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-indigo-400 text-white shadow-lg shadow-primary/30">
          <FileText className="h-7 w-7" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Jihad-Question maker</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          বইয়ের পাতার ছবি দিন, কয়েক সেকেন্ডেই পেয়ে যান প্রিন্টের উপযোগী ২-কলামের MCQ প্রশ্নপত্র ও উত্তরমালা।
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>নতুন প্রশ্নপত্র</CardTitle>
          <CardDescription>ছবি দিন, পরীক্ষার তথ্য লিখুন — বাকি কাজ AI করবে।</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-7">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">১ · বইয়ের পাতা</h3>
              <UploadZone images={images} onChange={setImages} disabled={loading} />
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">২ · পরীক্ষার তথ্য</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="examName" label="পরীক্ষার নাম" icon={PenLine} className="sm:col-span-2">
                  <Input id="examName" required placeholder="যেমন: অর্ধবার্ষিক পরীক্ষা ২০২৬" value={form.examName} onChange={set("examName")} disabled={loading} />
                </Field>
                <Field id="className" label="শ্রেণি" icon={GraduationCap}>
                  <Input id="className" required placeholder="যেমন: দশম" value={form.className} onChange={set("className")} disabled={loading} />
                </Field>
                <Field id="subject" label="বিষয়" icon={BookOpen}>
                  <Input id="subject" required placeholder="যেমন: পদার্থবিজ্ঞান" value={form.subject} onChange={set("subject")} disabled={loading} />
                </Field>
                <Field id="totalTime" label="মোট সময় (মিনিট)" icon={Clock}>
                  <Input id="totalTime" required type="number" min={1} placeholder="যেমন: 30" value={form.totalTime} onChange={set("totalTime")} disabled={loading} />
                </Field>
                <Field id="totalMarks" label="পূর্ণমান" icon={Award}>
                  <Input id="totalMarks" required type="number" min={1} placeholder="যেমন: 20" value={form.totalMarks} onChange={set("totalMarks")} disabled={loading} />
                </Field>
                <Field id="numQuestions" label="কতটি প্রশ্ন চাই" icon={Hash} className="sm:col-span-2">
                  <Input id="numQuestions" required type="number" min={1} max={100} placeholder="যেমন: 20 বা 30" value={form.numQuestions} onChange={set("numQuestions")} disabled={loading} />
                </Field>
              </div>
            </section>

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {step || "কাজ চলছে…"}
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5" />
                  প্রশ্নপত্র তৈরি করুন
                </>
              )}
            </Button>

            {loading && (
              <div className="space-y-2" aria-hidden>
                <div className="h-2 w-full animate-pulse rounded-full bg-secondary" />
                <div className="h-2 w-4/5 animate-pulse rounded-full bg-secondary" />
                <div className="h-2 w-3/5 animate-pulse rounded-full bg-secondary" />
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-primary" />
              আগের প্রশ্নপত্র
            </CardTitle>
            <CardDescription>
              এই ব্রাউজারে সংরক্ষিত আছে। যেকোনোটা আবার PDF করে নামাতে পারবেন, এতে AI-এর কোটা খরচ হয় না।
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{h.exam.examName}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        h.exam.className && `শ্রেণি ${h.exam.className}`,
                        h.exam.subject,
                        `${toBn(h.questions.length)}টি প্রশ্ন`,
                        formatDate(h.createdAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 px-3"
                      disabled={downloadingId === h.id || loading}
                      onClick={() => redownload(h)}
                    >
                      {downloadingId === h.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      PDF
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="মুছে ফেলুন"
                      onClick={() => removeItem(h.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        পরীক্ষায় ব্যবহারের আগে AI-এর তৈরি প্রশ্নগুলো অবশ্যই যাচাই করে নিন।
      </p>
    </main>
  );
}
