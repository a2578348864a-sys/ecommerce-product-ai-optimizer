"use client";

import { CopyButton } from "@/components/CopyButton";

type ResultSectionProps = {
  title: string;
  description: string;
  value: string | string[];
};

export function formatResultValue(value: string | string[]) {
  if (Array.isArray(value)) {
    return value.map((item, index) => `${index + 1}. ${item}`).join("\n");
  }

  return value;
}

export function ResultSection({ title, description, value }: ResultSectionProps) {
  const copyText = formatResultValue(value);
  const itemCount = Array.isArray(value) ? value.length : 1;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-200 hover:shadow-soft sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-950">{title}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {itemCount} 项
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
        <CopyButton text={copyText} />
      </div>

      {Array.isArray(value) ? (
        <ol className="space-y-2 text-sm leading-6 text-slate-700">
          {value.map((item, index) => (
            <li key={`${title}-${index}`} className="flex gap-3 rounded-md bg-slate-50 px-3 py-2">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-white text-xs font-semibold text-teal-700">
                {index + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="whitespace-pre-wrap rounded-md bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">
          {value}
        </div>
      )}
    </section>
  );
}
