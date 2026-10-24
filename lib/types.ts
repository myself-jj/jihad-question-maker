export interface ExamParams {
  examName: string;
  className: string;
  subject: string;
  totalTime: string;
  totalMarks: string;
  numQuestions: number;
}

export interface MCQ {
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
}

export interface UploadedImage {
  id: string;
  name: string;
  previewUrl: string;
  /** base64 payload without the data: prefix */
  base64: string;
  mimeType: string;
}
