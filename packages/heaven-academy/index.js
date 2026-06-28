import Study from './Study.jsx';
import { registerComponent } from '@linkup/core-sdk';
import { renderBookBlock } from './BookReader/subjects/Registry.jsx';

// Register the proprietary textbook renderer so the Host can use it dynamically
registerComponent('book-block-renderer', renderBookBlock);

export default Study;