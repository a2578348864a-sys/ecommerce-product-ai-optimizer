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

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <CopyButton text={copyText} />
      </div>

      {Array.isArray(value) ? (
        <ol className="space-y-2 text-sm leading-6 text-slate-700">
          {value.map((item, index) => (
            <li key={`${title}-${index}`} className="rounded-md bg-slate-50 px-3 py-2">
              <span className="mr-2 font-semibold text-teal-700">{index + 1}.</span>
              {item}
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
