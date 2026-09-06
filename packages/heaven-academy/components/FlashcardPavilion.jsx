import React, { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import FlashcardArena from './FlashcardArena.jsx';
import './FlashcardPavilion.css';

// Fallback high-yield freshman decks so the arena is playable immediately before ingestion edge functions run
const DEFAULT_DECKS = [
    {
        course_code: 'PHYS 1011',
        title: 'General Physics',
        desc: 'Vectors, Dynamics, Work & Thermodynamics',
        due_cards: 14,
        cards: [
            {
                front: "What is the fundamental difference between Instantaneous Velocity and Average Velocity?",
                back: "<strong>Instantaneous velocity</strong> is the velocity at a specific point in time (dx/dt), whereas <strong>average velocity</strong> is total displacement over the elapsed time interval (Δx/Δt).",
                ref: "General Physics, Page 42"
            },
            {
                front: "State Newton's Third Law in terms of interaction pairs.",
                back: "When two bodies interact, they apply forces to one another that are <strong>equal in magnitude and opposite in direction</strong>: F_AB = -F_BA.",
                ref: "General Physics, Page 61"
            },
            {
                front: "Under what condition does a force do zero work on an object?",
                back: "When the force is <strong>perpendicular to the displacement</strong> (cos 90° = 0) or when there is zero displacement.",
                ref: "General Physics, Page 78"
            }
        ]
    },
    {
        course_code: 'LOCT 1011',
        title: 'Logic & Critical Thinking',
        desc: 'Deductive Arguments, Fallacies & Truth Tables',
        due_cards: 10,
        cards: [
            {
                front: "What conditions are required for an argument to be 'Sound'?",
                back: "The argument must be <strong>structurally valid</strong>, and <strong>all its premises must be factually true</strong>.",
                ref: "Logic & Critical Thinking, Page 24"
            },
            {
                front: "What is the Fallacy of Equivocation?",
                back: "An informal fallacy where a key word or phrase is used with <strong>two or more different meanings</strong> in the same argument.",
                ref: "Logic & Critical Thinking, Page 98"
            }
        ]
    },
    {
        course_code: 'BIOL 1012',
        title: 'General Biology',
        desc: 'Cellular Division, Enzymes & Genetics',
        due_cards: 12,
        cards: [
            {
                front: "During which phase of mitosis do sister chromatids separate toward opposite poles?",
                back: "During <strong>Anaphase</strong>, the centromeres split and sister chromatids are pulled to opposite spindle poles.",
                ref: "General Biology, Page 93"
            }
        ]
    }
];

const FlashcardPavilion = ({ onClose }) => {
    const [stats, setStats] = useState({ mistakes_due: 0, course_decks: [] });
    const [activeSession, setActiveSession] = useState(null);

    useEffect(() => {
        supabase.rpc('get_flashcard_deck_stats')
            .then(({ data }) => {
                if (data && !data.error) setStats(data);
            })
            .catch(() => {});
    }, []);

    const handleStartMistakes = async () => {
        // Fetch user mistakes or fallback
        const { data } = await supabase
            .from('user_mistake_flashcards')
            .select('*')
            .limit(25);

        const cards = (data && data.length > 0) ? data.map(c => ({ ...c, is_mistake: true })) : [
            {
                id: 'm-mock-1',
                front: "Which fallacy occurs when an arguer distorts an opponent's argument to make it easier to attack?",
                back: "The <strong>Straw Man Fallacy</strong>. Misrepresenting an argument to refute a caricature instead of the real thesis.",
                ref: "Logic & Critical Thinking (Midterm Mistake)",
                is_mistake: true
            },
            {
                id: 'm-mock-2',
                front: "Is mechanical energy conserved in the presence of friction?",
                back: "<strong>No.</strong> Friction is a non-conservative force that dissipates mechanical energy into thermal energy.",
                ref: "General Physics (Assignment 1 Mistake)",
                is_mistake: true
            }
        ];

        setActiveSession({
            deck: { course_code: 'VAULT', title: 'Mistake Vault' },
            cards
        });
    };

    const handleStartCourse = async (courseCode, fallbackDeck) => {
        // Query database cards for this course
        const { data } = await supabase
            .from('course_flashcards')
            .select('*')
            .eq('course_code', courseCode)
            .limit(30);

        const cards = (data && data.length > 0) ? data : fallbackDeck.cards;

        setActiveSession({
            deck: { course_code: courseCode, title: fallbackDeck.title },
            cards
        });
    };

    return (
        <div className="fcp-overlay">
            <header className="fcp-header">
                <button className="fcp-back-btn" onClick={onClose}>
                    <i className="fas fa-chevron-left"></i>
                </button>
                <h2>Flashcard Decks</h2>
            </header>

            <main className="fcp-scroll-body">
                <span className="fcp-section-tag">⚡ Personalized Recovery</span>

                {/* Mistake Vault Card */}
                <div className="fcp-mistake-card" onClick={handleStartMistakes}>
                    <div className="fcp-mv-icon">
                        <i className="fas fa-bullseye"></i>
                    </div>
                    <div className="fcp-mv-info">
                        <h3>Mistake Vault</h3>
                        <p>Questions you missed on recent exam drills and book checkpoints</p>
                    </div>
                    <div className="fcp-badge-red">
                        {stats.mistakes_due > 0 ? `${stats.mistakes_due} Due` : 'Ready'}
                    </div>
                </div>

                <span className="fcp-section-tag" style={{ marginTop: '12px' }}>📚 Common Freshman Courses</span>

                {DEFAULT_DECKS.map((d) => (
                    <div key={d.course_code} className="fcp-deck-card" onClick={() => handleStartCourse(d.course_code, d)}>
                        <div className="fcp-cdc-icon">
                            <i className="fas fa-bolt"></i>
                        </div>
                        <div className="fcp-cdc-info">
                            <div className="fcp-cdc-code">{d.course_code}</div>
                            <div className="fcp-cdc-title">{d.title}</div>
                            <div className="fcp-cdc-desc">{d.desc}</div>
                        </div>
                        <div className="fcp-badge-teal">
                            {d.due_cards} Due
                        </div>
                    </div>
                ))}
            </main>

            {activeSession && (
                <FlashcardArena 
                    deck={activeSession.deck} 
                    cards={activeSession.cards} 
                    onClose={() => setActiveSession(null)} 
                />
            )}
        </div>
    );
};

export default FlashcardPavilion;