import dayjs from 'dayjs';

export function currentMonthRange(): { from: string; to: string } {
  const start = dayjs().startOf('month').format('YYYY-MM-DD');
  const end = dayjs().endOf('month').format('YYYY-MM-DD');
  return { from: start, to: end };
}
