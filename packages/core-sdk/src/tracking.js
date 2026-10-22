import { supabase } from './supabaseClient.js';

export const logQuestionAttempt = async ({
    userId,
    questionId = null,
    courseCode = 'Unknown',
    topicTag = 'General',
    sourceType = 'exam',
    sourceId = null,
    userAnswer
}) => {
    if (!userId) return null;
    try {
        const { data, error } = await supabase.rpc('submit_question_attempt', {
            p_question_id: questionId,
            p_user_answer: typeof userAnswer === 'object' ? userAnswer : JSON.parse(JSON.stringify(userAnswer || null)),
            p_source_type: sourceType,
            p_source_id: sourceId,
            p_topic_tag: topicTag,
            p_course_code: courseCode
        });
        if (error) {
            console.error("Attempt evaluation failed:", error);
            return null;
        }
        return data;
    } catch (e) {
        console.error("Attempt evaluation error:", e);
        return null;
    }
};