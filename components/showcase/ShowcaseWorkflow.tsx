"use client";

import { ArrowRight, Search, FileText, CheckCircle2, FileCheck } from "lucide-react";
import type { ShowcaseContent } from "@/content/showcase";

interface ShowcaseWorkflowProps {
  workflow: ShowcaseContent["workflow"];
}

const STEP_ICONS = [Search, FileText, CheckCircle2, FileCheck];

export function ShowcaseWorkflow({ workflow }: ShowcaseWorkflowProps) {
  return (
    <section className="w-full py-16 sm:py-20" aria-labelledby="workflow-heading">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
            Core Methodology
          </p>
          <h2
            id="workflow-heading"
            className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl"
          >
            {workflow.sectionTitle}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            {workflow.sectionSubtitle}
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {workflow.steps.map((item, index) => {
            const Icon = STEP_ICONS[index] || FileText;
            const isLast = index === workflow.steps.length - 1;

            return (
              <div
                key={item.step}
                className="relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-soft transition-all duration-200 hover:border-teal-200 hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-bold tabular-nums text-slate-400">
                      {item.step}
                    </span>
                  </div>

                  <h3 className="mt-4 text-base font-bold tracking-tight text-slate-900">
                    {item.title}
                  </h3>

                  <p className="mt-1 text-xs font-semibold text-teal-700">
                    {item.summary}
                  </p>

                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    {item.desc}
                  </p>
                </div>

                {!isLast && (
                  <div
                    className="hidden lg:absolute -right-3 top-1/2 -translate-y-1/2 z-10 size-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-xs lg:flex"
                    aria-hidden="true"
                  >
                    <ArrowRight className="size-3" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
