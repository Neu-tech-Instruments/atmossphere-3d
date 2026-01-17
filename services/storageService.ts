
const DB_NAME = 'AtmosSphereDB';
const DB_VERSION = 2;
const STORE_NAME = 'audioFiles';

export interface StoredAudio {
    file: File;
    name: string;
    type: string;
    timestamp: number;
}

export const storageService = {
    async initDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error('Database error:', event);
                reject('Error opening database');
            };

            request.onsuccess = (event) => {
                resolve((event.target as IDBOpenDBRequest).result);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                // Delete old store if strictly upgrading structure to ensure clean slate
                if (db.objectStoreNames.contains(STORE_NAME)) {
                    db.deleteObjectStore(STORE_NAME);
                }
                // Create new store with 'name' as the primary key
                db.createObjectStore(STORE_NAME, { keyPath: 'name' });
            };
        });
    },

    async saveAudioFile(file: File): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const data: StoredAudio = {
                file: file,
                name: file.name,
                type: file.type,
                timestamp: Date.now()
            };

            const request = store.put(data); // keyPath is 'name', so no explicit key needed

            request.onsuccess = () => resolve();
            request.onerror = () => reject('Error saving file');
        });
    },

    async getAudioFile(name: string): Promise<File | null> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(name);

            request.onsuccess = () => {
                const result = request.result;
                if (result && result.file) {
                    resolve(result.file);
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => reject('Error retrieving file');
        });
    },

    async getAllAudioFiles(): Promise<StoredAudio[]> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                // Sort by timestamp descending (newest first)
                const results = (request.result as StoredAudio[]).sort((a, b) => b.timestamp - a.timestamp);
                resolve(results);
            };

            request.onerror = () => reject('Error retrieving files');
        });
    },

    async deleteAudioFile(name: string): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(name);

            request.onsuccess = () => resolve();
            request.onerror = () => reject('Error deleting file');
        });
    }
};
