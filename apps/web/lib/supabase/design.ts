import { supabase } from './client';
import { BarrelState } from '@/lib/store/useBarrelStore';

export interface SavedDesign {
    id: string;
    user_id: string;
    title: string;
    parameters: Partial<BarrelState>;
    estimated_weight: number;
    center_of_gravity: number;
    created_at: string;
}

export const saveDesign = async (
    title: string,
    state: BarrelState,
    weight: number,
    cog: number
) => {
    // Requires Auth user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Must be logged in to save");

    const params = {
        length: state.length,
        maxDiameter: state.maxDiameter,
        cuts: state.cuts,
        materialDensity: state.materialDensity
    };

    const { data, error } = await supabase
        .from('designs')
        .insert({
            user_id: user.id,
            title,
            parameters: params,
            estimated_weight: weight,
            center_of_gravity: cog
        })
        .select()
        .single();

    if (error) throw error;
    return data;
};

export const fetchDesigns = async () => {
    const { data, error } = await supabase
        .from('designs')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data as SavedDesign[];
};
