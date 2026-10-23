import { readdirSync } from 'node:fs';

export const coreClips = {
  idle: '待机呼吸休闲',
  drag: '被鼠标拖拽悬空反馈',
  click: '点击回应-开心跃动',
  thinking: '工作状态-思考冒泡',
  working: '工作状态-忙碌点按',
  result: '工作状态-清点归档',
  waiting: '工作状态-原地踱步张望',
  success: '工作状态-雀跃庆祝',
  error: '工作状态-垂头叹气冒汗',
};

export function actionCatalog() {
  const aliases = new Map(Object.entries(coreClips).map(([key, label]) => [label, key]));
  return readdirSync(new URL('../../assets/webm/', import.meta.url))
    .filter((file) => file.endsWith('.webm'))
    .map((file) => file.slice(0, -5))
    .sort((first, second) => first.localeCompare(second, 'zh-Hans'))
    .map((label) => ({ label, clip: aliases.get(label) ?? label }));
}

export function animationSource(name) {
  const action = actionCatalog().find((entry) => entry.clip === name);
  if (!action) throw new Error('Unknown pet animation');
  return new URL(`../../assets/webm/${encodeURIComponent(action.label)}.webm`, import.meta.url);
}

export function clickResponses() {
  return actionCatalog()
    .filter((action) => action.label.startsWith('点击回应-'))
    .map((action) => action.clip);
}
