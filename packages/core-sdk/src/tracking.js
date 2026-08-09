import { supabase } from './supabaseClient.js';

export const logQuestionAttempt = async ({
    userId,
    questionId = null,
    courseCode = 'Unknown',
    topicTag = 'General',
    sourceType,
    sourceId = null,
    questionSnapshot,
    userAnswer,
    isCorrect
}) => {
    if (!userId) return;
    try {
        // Fire-and-forget non-blocking insert
        supabase.from('user_question_attempts').insert({
            user_id: userId,
            question_id: questionId,
            course_code: courseCode,
            topic_tag: topicTag,
            source_type: sourceType,
            source_id: sourceId,
            question_snapshot: questionSnapshot,
            user_answer: userAnswer,
            is_correct: isCorrect
        }).then(({ error }) => {
            if (error) console.error("Attempt logging failed:", error);
        });
    } catch (e) {
        console.error("Attempt logging error:", e);
    }
};