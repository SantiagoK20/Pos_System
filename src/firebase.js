import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyByBf4xJCXoi1zJi3vUGHnYr_f8cqTDqDk",
    authDomain: "atecles-grill-pos.firebaseapp.com",
    projectId: "atecles-grill-pos",
    storageBucket: "atecles-grill-pos.firebasestorage.app",
    messagingSenderId: "932278606296",
    appId: "1:932278606296:web:8df9f918e12def0a457aad"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);