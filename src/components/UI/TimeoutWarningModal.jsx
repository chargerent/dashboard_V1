// src/components/UI/TimeoutWarningModal.jsx

function TimeoutWarningModal({ onStay, onLogout }) {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-xl text-center max-w-sm mx-auto">
                <h2 className="text-xl font-bold mb-4">Are you still there?</h2>
                <p className="text-gray-600 mb-6">You will be logged out in 1 minute due to inactivity.</p>
                <div className="flex justify-center gap-4">
                    <button onClick={onLogout} className="bg-gray-300 text-gray-800 font-semibold py-2 px-6 rounded-md hover:bg-gray-400">
                        Logout
                    </button>
                    <button onClick={onStay} className="bg-blue-600 text-white font-semibold py-2 px-6 rounded-md hover:bg-blue-700">
                        Stay Logged In
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TimeoutWarningModal;