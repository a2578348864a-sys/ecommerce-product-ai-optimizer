"use client";

import { Check, Compass, Cpu, Lock, TestTube2 } from "lucide-react";
import type { ShowcaseContent } from "@/content/showcase";

interface ShowcaseWorkScopeProps {
  projectWork: ShowcaseContent["projectWork"];
}

const WORK_ICONS = [Compass, Cpu, Lock, TestTube2];

export function ShowcaseWorkScope({ projectWork }: ShowcaseWorkScopeProps) {
  return (
    <section className="w-full bg-slate-50/60 py-16 sm:py-20 border-t border-slate-200/60" aria-labelledby="work-heading">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
            Role & Deliverables
          </p>
          <h2
            id="work-heading"
            className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl"
          >
            {projectWork.sectionTitle}
          </h2>
          <div className="mx-auto mt-3 max-w-2xl rounded-xl border border-teal-200/70 bg-teal-50/50 p-3.5 text-center">
            <p className="text-xs sm:text-sm font-medium leading-relaxed text-teal-900">
              {projectWork.roleStatement}
            </p>
          </div>
        </div>

        {/* 4 项具体工作 */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {projectWork.items.map((item, index) => {
            const Icon = WORK_ICONS[index] || Check;
            return (
              <div
                key={item.title}
                className="flex items-start gap-4 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-soft"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 sm:text-sm">
                    {item.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* 状态徽章区 */}
        <div className="mt-12 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-soft">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Project Milestone
              </p>
              <p className="mt-0.5 text-sm font-bold text-slate-900">
                {projectWork.baseline}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              {projectWork.badges.map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  <span className="size-1.5 rounded-full bg-teal-500" aria-hidden="true" />
                  <span>{badge}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
