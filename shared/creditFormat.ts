export const formatPoints = (points: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(points);
