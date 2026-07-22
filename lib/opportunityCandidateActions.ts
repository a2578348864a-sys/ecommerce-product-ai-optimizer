export type CandidateDeletePresentationInput = {
  isOfficialReadonly: boolean;
  isLocalDraft: boolean;
  hasLinkedTask: boolean;
};

export function getCandidateDeletePresentation(input: CandidateDeletePresentationInput) {
  if (input.isLocalDraft) {
    return {
      canDelete: true,
      label: "删除候选",
      title: "从当前浏览器候选池删除。",
    };
  }
  if (input.hasLinkedTask) {
    return {
      canDelete: false,
      label: "已转任务，候选来源证据需保留",
      title: "已转任务的候选承载来源证据，不能硬删除。",
    };
  }
  if (input.isOfficialReadonly) {
    return {
      canDelete: false,
      label: "正式候选不可删除",
      title: "访客体验模式下不能删除正式候选数据。",
    };
  }
  return {
    canDelete: true,
    label: "删除候选",
    title: "删除候选。",
  };
}
