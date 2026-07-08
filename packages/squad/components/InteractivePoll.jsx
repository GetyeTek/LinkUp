import React, { useState, useEffect } from 'react';
import { supabase } from '@linkup-platform/sdk-core';
import './InteractivePoll.css';

const InteractivePoll = ({ pollData, msgId, currentUser }) => {
    const [votes, setVotes] = useState([]);
    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        if (String(msgId).startsWith('temp-')) return;

        const fetchVotes = async () => {
            const { data } = await supabase.from('poll_votes').select('user_id, option_index').eq('message_id', msgId);
            if (data) setVotes(data);
        };
        fetchVotes();

        const channel = supabase.channel(`poll_${msgId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'poll_votes', filter: `message_id=eq.${msgId}` }, (payload) => {
                setVotes(prev => [...prev, { user_id: payload.new.user_id, option_index: payload.new.option_index }]);
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'poll_votes', filter: `message_id=eq.${msgId}` }, (payload) => {
                setVotes(prev => prev.filter(v => !(v.user_id === payload.old.user_id && v.option_index === payload.old.option_index)));
            })
            .subscribe();

        // Timer for deadlines
        const timer = setInterval(() => setCurrentTime(Date.now()), 60000);

        return () => {
            supabase.removeChannel(channel);
            clearInterval(timer);
        };
    }, [msgId]);

    const isExpired = pollData.deadline && new Date(pollData.deadline).getTime() < currentTime;
    const myVotes = votes.filter(v => v.user_id === currentUser.id).map(v => v.option_index);
    const hasVoted = myVotes.length > 0;
    const totalVotes = votes.length;

    // A poll reveals answers if: it's expired OR the user has voted OR it's a quiz that allows multiple tries (actually quizzes usually reveal after voting)
    const showResults = hasVoted || isExpired || !pollData.allow_revote;

    const handleVote = async (index) => {
        if (String(msgId).startsWith('temp-')) return;
        if (isExpired) return;
        // In Quiz Mode, we lock the poll after the first interaction
        if (pollData.quiz_mode && hasVoted) return;
        if (hasVoted && !pollData.allow_revote && !myVotes.includes(index)) return;

        // Optimistic UI updates
        const isSelected = myVotes.includes(index);
        
        setVotes(prev => {
            let next = [...prev];
            if (!pollData.multiple_answers && !isSelected) {
                next = next.filter(v => v.user_id !== currentUser.id);
            }
            if (isSelected) {
                if (pollData.allow_revote) next = next.filter(v => !(v.user_id === currentUser.id && v.option_index === index));
            } else {
                next.push({ user_id: currentUser.id, option_index: index });
            }
            return next;
        });

        // Fire RPC securely - Parameters matched to short SQL names
        try {
            await supabase.rpc('cast_poll_vote', { req_message_id: msgId, req_option_index: index });
        } catch (err) {
            console.error("Vote failed:", err);
            // In a production app, we would rollback the optimistic update here on failure
        }
    };

    const formatDeadline = (iso) => {
        if (!iso) return null;
        const ms = new Date(iso).getTime() - currentTime;
        if (ms <= 0) return 'Poll Ended';
        const hrs = Math.floor(ms / 3600000);
        const mins = Math.floor((ms % 3600000) / 60000);
        if (hrs > 24) return `Ends in ${Math.floor(hrs/24)}d`;
        if (hrs > 0) return `Ends in ${hrs}h ${mins}m`;
        return `Ends in ${mins}m`;
    };

    return (
        <div className="poll-bubble-container">
            <div className="poll-header">
                <div className="poll-meta-tag">
                    <i className={`fas fa-${pollData.quiz_mode ? 'lightbulb' : 'chart-bar'}`}></i>
                    {pollData.quiz_mode ? 'Quiz' : 'Poll'}
                    {pollData.multiple_answers && ' • Multiple Choice'}
                </div>
                <div className="poll-question">{pollData.question}</div>
                {pollData.description && <div className="poll-description">{pollData.description}</div>}
            </div>

            <div className="poll-options-list">
                {pollData.options.map((optText, idx) => {
                    const voteCount = votes.filter(v => v.option_index === idx).length;
                    const percentage = totalVotes === 0 ? 0 : Math.round((voteCount / totalVotes) * 100);
                    const isSelected = myVotes.includes(idx);
                    
                    let indicatorClass = "poll-indicator";
                    if (pollData.quiz_mode && showResults) {
                        if (idx === pollData.correct_option_index) {
                            indicatorClass += " quiz-correct";
                        } else if (isSelected) {
                            indicatorClass += " quiz-wrong";
                        }
                    }

                    return (
                        <div 
                            key={idx} 
                            className={`poll-option-btn ${isSelected ? 'selected' : ''} ${isExpired || (hasVoted && !pollData.allow_revote) ? 'disabled' : ''}`}
                            onClick={() => handleVote(idx)}
                        >
                            {showResults && (
                                <div className="poll-progress-fill" style={{ transform: `scaleX(${percentage / 100})` }}></div>
                            )}
                            <div className="poll-option-content">
                                <div className={indicatorClass}></div>
                                <div className="poll-option-text">{optText}</div>
                                {showResults && <div className="poll-option-perc">{percentage}%</div>}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="poll-footer-meta">
                <span>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
                {pollData.deadline && <span>{formatDeadline(pollData.deadline)}</span>}
            </div>
        </div>
    );
};

export default InteractivePoll;