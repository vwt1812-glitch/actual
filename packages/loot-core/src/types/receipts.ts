export type Receipt = {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
};

export type ReceiptResult<T> =
  | { data: T; error?: never }
  | { error: string; data?: never };

