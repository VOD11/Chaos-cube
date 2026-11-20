// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCORdO0x7H9MBHJzcpn-yQdnY9PIbF5crI",
  authDomain: "chaoscube-7617a.firebaseapp.com",
  projectId: "chaoscube-7617a",
  storageBucket: "chaoscube-7617a.firebasestorage.app",
  messagingSenderId: "805471643934",
  appId: "1:805471643934:web:feebc0f0190ed586f9810f",
  measurementId: "G-EQY2HMMHXW"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
