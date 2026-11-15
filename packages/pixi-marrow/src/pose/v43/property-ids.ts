/** Gives every official property id string a number. Equal strings get the same number. */
export class PropertyIds {
    private readonly numbers = new Map<string, number>();

    get count(): number {
        return this.numbers.size;
    }

    of(key: string): number {
        let id = this.numbers.get(key);

        if (id === undefined) {
            id = this.numbers.size;
            this.numbers.set(key, id);
        }

        return id;
    }
}
