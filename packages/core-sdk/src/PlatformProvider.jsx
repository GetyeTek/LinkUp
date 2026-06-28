import React, { createContext, useContext } from 'react';

const PlatformContext = createContext(null);

export const PlatformProvider = PlatformContext.Provider;

export const usePlatform = () => {
    const context = useContext(PlatformContext);
    if (!context) {
        throw new Error("usePlatform must be used within a PlatformProvider. Ensure the Host App is injecting the shell.");
    }
    return context;
};