
const DB_NAME = 'AtmosSphereDB';
const DB_VERSION = 1;
const STORE_NAME = 'audioFiles';
const FILE_KEY = 'currentTrack';

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
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
        });
    },

    async saveAudioFile(file: File): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            // Store the file and its name
            const data = {
                file: file,
                name: file.name,
                type: file.type,
                timestamp: Date.now()
            };

            const request = store.put(data, FILE_KEY);

            request.onsuccess = () => resolve();
            request.onerror = () => reject('Error saving file');
        });
    },

    async getAudioFile(): Promise<File | null> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(FILE_KEY);

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
    }
};
