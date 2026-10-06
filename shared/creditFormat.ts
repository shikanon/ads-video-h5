const pointsFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatPoints = (points: number) => pointsFormatter.format(points);
