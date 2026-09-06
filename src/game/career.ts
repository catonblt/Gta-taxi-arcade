/** Everything that survives a shift. M5 hangs the garage and the parts inventory off this. */
export class Career {
  cash = 0;
  shifts = 0;
  bestShift = 0;
  jobsCompleted = 0;

  bank(amount: number): void {
    this.cash += amount;
    this.shifts++;
    if (amount > this.bestShift) this.bestShift = amount;
  }
}
