//@ts-check

export class Observable {

    /**
     * @type {Array<Observable>}
     */
    #observers = [];

    /**
     * dummy for consistency
     */
    update() {
       console.warn("Not implemented");
    }

    /**
     * calls all the observers
     */
    doUpdate() {
        this.#observers.forEach(obs => obs.update());
    }

    /**
     * @param {{update(): void}} obj
     */
    subscribe(obj) {
        this.#observers.push(obj);
    }

    /**
     * @param {{update(): void}} obj
     */
    unsubscribe(obj) {
        this.#observers = this.#observers.filter(elem => elem!=obj);
    }

}