/** A multiple-choice question: the question, four answers, and which answer (0 to 3) is right. */
export interface TriviaQuestion {
  q: string;
  a: readonly [string, string, string, string];
  c: number;
}

/** General knowledge, easy to medium, safe for a chat between strangers. */
export const TRIVIA: readonly TriviaQuestion[] = [
  {
    q: "What is the largest planet in our solar system?",
    a: ["Mars", "Jupiter", "Saturn", "Neptune"],
    c: 1,
  },
  { q: "How many continents are there?", a: ["5", "6", "7", "8"], c: 2 },
  {
    q: "Which animal is known as the king of the jungle?",
    a: ["Tiger", "Lion", "Elephant", "Bear"],
    c: 1,
  },
  { q: "What is the capital of Japan?", a: ["Osaka", "Kyoto", "Tokyo", "Nagoya"], c: 2 },
  { q: "How many days are in a leap year?", a: ["364", "365", "366", "367"], c: 2 },
  {
    q: "Which planet is known as the Red Planet?",
    a: ["Venus", "Mars", "Mercury", "Jupiter"],
    c: 1,
  },
  { q: "What do bees make?", a: ["Milk", "Honey", "Butter", "Cheese"], c: 1 },
  { q: "Which is the largest ocean?", a: ["Atlantic", "Indian", "Pacific", "Arctic"], c: 2 },
  { q: "What is H2O more commonly called?", a: ["Salt", "Water", "Air", "Oil"], c: 1 },
  { q: "How many legs does a spider have?", a: ["6", "8", "10", "12"], c: 1 },
  { q: "Which country is the kangaroo from?", a: ["Brazil", "Australia", "India", "Kenya"], c: 1 },
  { q: "What is the capital of France?", a: ["Lyon", "Paris", "Marseille", "Nice"], c: 1 },
  {
    q: "Which gas do plants take in from the air?",
    a: ["Oxygen", "Carbon dioxide", "Helium", "Nitrogen"],
    c: 1,
  },
  { q: "How many colours are in a rainbow?", a: ["5", "6", "7", "8"], c: 2 },
  {
    q: "Who painted the Mona Lisa?",
    a: ["Picasso", "Van Gogh", "Leonardo da Vinci", "Monet"],
    c: 2,
  },
  { q: "What is the smallest prime number?", a: ["0", "1", "2", "3"], c: 2 },
  { q: "Which is the fastest land animal?", a: ["Lion", "Cheetah", "Horse", "Leopard"], c: 1 },
  { q: "How many strings does a standard guitar have?", a: ["4", "5", "6", "7"], c: 2 },
  {
    q: "What is the tallest mountain above sea level?",
    a: ["K2", "Mount Everest", "Kilimanjaro", "Mont Blanc"],
    c: 1,
  },
  {
    q: "Which instrument has black and white keys?",
    a: ["Violin", "Piano", "Flute", "Drum"],
    c: 1,
  },
  { q: "What is the capital of Canada?", a: ["Toronto", "Vancouver", "Ottawa", "Montreal"], c: 2 },
  {
    q: "How many players are on the pitch for one football (soccer) team?",
    a: ["9", "10", "11", "12"],
    c: 2,
  },
  { q: "What is the hardest natural substance?", a: ["Gold", "Iron", "Diamond", "Quartz"], c: 2 },
  { q: "Which planet is famous for its rings?", a: ["Mars", "Saturn", "Earth", "Mercury"], c: 1 },
  {
    q: "What language is mostly spoken in Brazil?",
    a: ["Spanish", "Portuguese", "French", "English"],
    c: 1,
  },
  { q: "How many sides does a hexagon have?", a: ["5", "6", "7", "8"], c: 1 },
  {
    q: "At what temperature does water boil at sea level (Celsius)?",
    a: ["90", "100", "110", "120"],
    c: 1,
  },
  {
    q: "Which sea creature has eight arms?",
    a: ["Shark", "Octopus", "Dolphin", "Jellyfish"],
    c: 1,
  },
  { q: "What is the largest mammal?", a: ["Elephant", "Blue whale", "Giraffe", "Hippo"], c: 1 },
  { q: "Which month has the fewest days?", a: ["January", "February", "April", "June"], c: 1 },
  {
    q: "What colour do you get by mixing blue and yellow?",
    a: ["Purple", "Green", "Orange", "Brown"],
    c: 1,
  },
  {
    q: "Which country gave the Statue of Liberty to the USA?",
    a: ["Spain", "France", "Italy", "Germany"],
    c: 1,
  },
  { q: "How many hours are in a day?", a: ["12", "24", "36", "48"], c: 1 },
  { q: "What is the currency of Japan?", a: ["Won", "Yuan", "Yen", "Baht"], c: 2 },
  {
    q: "Which bird lives in Antarctica and cannot fly?",
    a: ["Ostrich", "Penguin", "Eagle", "Owl"],
    c: 1,
  },
  { q: "How many keys are on a standard piano?", a: ["76", "84", "88", "92"], c: 2 },
  { q: "At what temperature does water freeze (Celsius)?", a: ["-10", "0", "10", "32"], c: 1 },
  { q: "Which planet is closest to the Sun?", a: ["Venus", "Earth", "Mercury", "Mars"], c: 2 },
  { q: "What is the chemical symbol for gold?", a: ["Ag", "Au", "Gd", "Go"], c: 1 },
  { q: "Which sport uses a shuttlecock?", a: ["Tennis", "Badminton", "Squash", "Golf"], c: 1 },
];
